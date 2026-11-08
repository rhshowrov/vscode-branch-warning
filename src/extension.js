'use strict';

const vscode = require('vscode');
const { createHash } = require('node:crypto');
const { GitRepository } = require('./git');
const { BranchTracker } = require('./tracker');
const { present } = require('./presentation');
const { FlagStore } = require('./storage');

async function activate(context) {
  const store = new FlagStore(context.globalStorageUri.fsPath);
  const output = vscode.window.createOutputChannel('Branch Warning');
  const item = vscode.window.createStatusBarItem('branchWarning.indicator', vscode.StatusBarAlignment.Left, 10001);
  item.name = 'Branch Warning';
  item.command = 'git.checkout';
  context.subscriptions.push(output, item);
  let session;
  let timer;
  let busy = false;
  let disposed = false;
  let lastError;
  let rendered;

  function log(message) { output.appendLine(`[${new Date().toISOString()}] ${message}`); }

  function showUnavailable(message) {
    item.hide();
    rendered = { kind: 'unavailable', message, visible: false };
  }

  async function refresh() {
    if (busy || disposed) return;
    busy = true;
    try {
      const folders = vscode.workspace.workspaceFolders || [];
      if (folders.length !== 1 || folders[0].uri.scheme !== 'file') {
        session = undefined;
        if (!folders.length) { item.hide(); rendered = { kind: 'noRepository', visible: false }; }
        else showUnavailable('Branch Warning v0.1 supports one local Git repository per window.');
        return;
      }
      const folder = folders[0];
      const config = vscode.workspace.getConfiguration('branchWarning', folder.uri);
      if (!config.get('enabled', true)) {
        session = undefined;
        item.hide();
        rendered = { kind: 'disabled', visible: false };
        return;
      }
      const executable = vscode.workspace.getConfiguration('git', folder.uri).get('path') || 'git';
      if (!session || session.folder !== folder.uri.toString() || session.executable !== executable) {
        const repo = await GitRepository.open(folder.uri.fsPath, executable);
        const key = `repository.${createHash('sha256').update(repo.commonDir).digest('hex')}`;
        const saved = await store.load(key);
        session = { folder: folder.uri.toString(), executable, repo, key, tracker: new BranchTracker(saved), persisted: JSON.stringify(saved) };
        log('Monitoring the open Git repository. Existing activity is the baseline; offline activity will not be replayed.');
      }
      const rules = {
        forbiddenBranches: config.get('forbiddenBranches', ['staging']),
        viewOnlyBranches: config.get('viewOnlyBranches', ['dev', 'main']),
      };
      const beforeFlags = session.tracker.serialize();
      const snapshot = await session.repo.snapshot();
      session.tracker.update(snapshot, rules);
      const saved = session.tracker.serialize();
      if (JSON.stringify(saved) !== session.persisted) {
        await store.save(session.key, saved);
        session.persisted = JSON.stringify(saved);
        for (const [branch, flag] of Object.entries(saved)) {
          if (!beforeFlags[branch]) log(`${branch}: ${flag.reason} (${flag.source}). Warning saved permanently.`);
        }
      }
      const status = session.tracker.status(snapshot, rules);
      const model = present(status);
      item.text = model.text;
      item.backgroundColor = model.background ? new vscode.ThemeColor(model.background) : undefined;
      item.color = undefined;
      item.tooltip = new vscode.MarkdownString(model.tooltip);
      item.accessibilityInformation = { label: model.label };
      item.command = 'git.checkout';
      if (model.visible) item.show();
      else item.hide();
      rendered = { ...status, ...model };
      lastError = undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message !== lastError) { log(message); lastError = message; }
      showUnavailable('Branch Warning cannot read this repository. Use Branch Warning: Show Activity Log for details.');
    } finally { busy = false; }
  }

  function schedule() {
    clearTimeout(timer);
    if (disposed) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    const delay = vscode.workspace.getConfiguration('branchWarning', folder?.uri).get('pollIntervalMs', 1000);
    timer = setTimeout(async () => { await refresh(); schedule(); }, Math.max(500, delay));
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('branchWarning.refresh', refresh),
    vscode.commands.registerCommand('branchWarning.openSettings', () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', 'branchWarning')),
    vscode.commands.registerCommand('branchWarning.showOutput', () => output.show()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('branchWarning') || event.affectsConfiguration('git.path')) {
        void refresh(); schedule();
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { session = undefined; void refresh(); }),
    { dispose() { disposed = true; clearTimeout(timer); } },
  );
  await refresh();
  schedule();
  return { refresh, getStatus: () => rendered, getFlags: () => session?.tracker.serialize() || {} };
}

function deactivate() {}
module.exports = { activate, deactivate };
