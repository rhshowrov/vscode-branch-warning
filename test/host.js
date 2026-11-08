'use strict';

const vscode = require('vscode');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const repo = process.env.BRANCH_WARNING_HOST_REPO;
  const output = process.env.BRANCH_WARNING_HOST_OUTPUT;
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, stdio: 'pipe' });
  const extension = vscode.extensions.getExtension('branch-warning-local.branch-warning');
  assert.ok(extension, 'VS Code discovers the extension manifest');
  const api = await extension.activate();
  const builtinGit = (await vscode.extensions.getExtension('vscode.git').activate()).getAPI(1);
  async function expect(kind) {
    for (let attempt = 0; attempt < 40; attempt++) {
      await api.refresh();
      if (api.getStatus()?.kind === kind) return api.getStatus();
      await delay(100);
    }
    assert.fail(`Expected ${kind}, received ${JSON.stringify(api.getStatus())}`);
  }
  async function capture(name) {
    const repository = builtinGit.repositories.find(repository => repository.rootUri.fsPath === repo)
      || await builtinGit.openRepository(vscode.Uri.file(repo));
    assert.ok(repository, 'The built-in Git repository is available');
    await repository.status();
    assert.equal(repository.state.HEAD?.name, api.getStatus().branch, 'Capture the same current branch in both indicators');
    await delay(800);
    execFileSync('import', ['-window', 'root', path.join(output, `${name}.png`)]);
  }
  if (process.env.BRANCH_WARNING_HOST_PHASE === 'restart') {
    assert.equal((await expect('normal')).visible, false);
    assert.equal(api.getFlags()['feature/created-while-closed'], undefined, 'Closed-editor branch creation is not replayed');
    git('switch', 'feature/staging-warning');
    await expect('flagged');
    assert.ok(api.getFlags()['feature/inherited-warning'], 'Inherited warning survives an actual process restart');
    const first = JSON.parse(await fs.readFile(path.join(output, 'phase1.json'), 'utf8'));
    first.checks.push('saved warnings survive an actual VS Code process restart', 'closed-editor activity excluded after restart');
    await fs.writeFile(path.join(output, 'result.json'), JSON.stringify(first, null, 2));
    console.log('Branch Warning: real restart persistence checks passed.');
    return;
  }
  await vscode.workspace.getConfiguration('workbench').update('colorTheme', 'Default Dark Modern', vscode.ConfigurationTarget.Global);
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  const doc = await vscode.workspace.openTextDocument(path.join(repo, 'example.js'));
  await vscode.window.showTextDocument(doc);
  let status = await expect('viewOnly');
  assert.equal(status.branch, 'dev'); assert.equal(status.background, 'statusBarItem.warningBackground');
  assert.equal(status.visible, true);
  await capture('view-only');

  git('switch', '-c', 'feature/normal', 'dev');
  status = await expect('normal'); assert.equal(status.background, undefined);
  assert.equal(status.visible, false);
  await capture('normal');

  git('switch', '--detach', 'dev');
  assert.equal((await expect('detached')).visible, false);
  git('switch', 'feature/normal');
  assert.equal((await expect('normal')).visible, false);

  git('switch', '-c', 'feature/staging-warning', 'staging');
  status = await expect('flagged'); assert.equal(status.source, 'staging');
  assert.equal(status.background, 'statusBarItem.errorBackground');
  assert.equal(status.visible, true);
  await capture('permanent-warning');
  git('switch', 'feature/normal');
  assert.equal((await expect('normal')).visible, false);
  git('switch', 'feature/staging-warning');
  assert.equal((await expect('flagged')).visible, true);
  git('reset', '--hard', 'dev'); await expect('flagged');
  git('switch', '-c', 'feature/inherited-warning'); await expect('flagged');

  const scope = vscode.workspace.workspaceFolders[0].uri;
  const config = vscode.workspace.getConfiguration('branchWarning', scope);
  await config.update('enabled', false, vscode.ConfigurationTarget.Workspace); await expect('disabled');
  git('switch', '-c', 'feature/unobserved', 'staging');
  await config.update('enabled', true, vscode.ConfigurationTarget.Workspace); await expect('normal');
  git('switch', 'feature/staging-warning'); await expect('flagged');

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('branchWarning.openSettings'));
  assert.ok(commands.includes('git.checkout'), 'Clicking the indicator can open VS Code branch selection');
  await fs.writeFile(path.join(output, 'phase1.json'), JSON.stringify({
    passed: true, vscode: vscode.version,
    checks: ['activation', 'amber dev shown', 'normal branch indicator hidden', 'detached HEAD indicator hidden', 'red staging provenance shown', 'warning visibility transitions', 'reset permanence', 'inheritance', 'disable and offline baseline', 'saved warning restoration', 'commands'],
    screenshots: ['view-only.png', 'normal.png', 'permanent-warning.png'],
  }, null, 2));
  console.log('Branch Warning: real VS Code extension-host checks passed.');
}

module.exports = { run };
