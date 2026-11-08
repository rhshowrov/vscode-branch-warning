'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'branch-warning-host-'));
const repo = path.join(temp, 'repo');
fs.mkdirSync(repo);
const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
  cwd: repo, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
});
git('init', '-b', 'dev'); git('config', 'user.name', 'Host Test'); git('config', 'user.email', 'host@example.invalid');
git('config', 'commit.gpgsign', 'false');
fs.writeFileSync(path.join(repo, 'example.js'), '// Temporary repository for Branch Warning verification.\nconst branch = "dev";\n');
git('add', '.'); git('commit', '-m', 'initial'); git('branch', 'main');
git('switch', '-c', 'staging'); fs.writeFileSync(path.join(repo, 'staging.txt'), 'staging\n');
git('add', '.'); git('commit', '-m', 'staging changes'); git('switch', 'dev');

const executable = process.env.VSCODE_EXECUTABLE || '/snap/code/current/usr/share/code/code';
const args = [
  '-a', '-s', '-screen 0 1440x1000x24', executable,
  '--no-sandbox', '--disable-gpu', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
  '--user-data-dir', path.join(temp, 'user-data'), '--extensions-dir', path.join(temp, 'extensions'),
  `--extensionDevelopmentPath=${root}`, `--extensionTestsPath=${path.join(root, 'test', 'host.js')}`, repo,
];
console.log(`Isolated VS Code test output: ${temp}`);
const logPath = path.join(temp, 'vscode.log');
async function launch(phase) {
  const env = { ...process.env, BRANCH_WARNING_HOST_REPO: repo, BRANCH_WARNING_HOST_OUTPUT: temp, BRANCH_WARNING_HOST_PHASE: phase };
  delete env.ELECTRON_RUN_AS_NODE;
  const log = fs.openSync(logPath, 'a');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn('xvfb-run', args, { stdio: ['ignore', log, log], env });
      const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('VS Code host test timed out')); }, 120000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`VS Code exited ${code}`)); });
    });
  } finally { fs.closeSync(log); }
}

(async () => {
  await launch('initial');
  if (!fs.existsSync(path.join(temp, 'phase1.json'))) throw new Error('Host runner exited without running its tests');
  console.log('Initial extension-host and rendering checks passed. Testing a real restart.');
  git('switch', '-c', 'feature/created-while-closed', 'staging');
  await launch('restart');
  const result = JSON.parse(fs.readFileSync(path.join(temp, 'result.json'), 'utf8'));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => {
  console.error(error.message);
  if (fs.existsSync(logPath)) console.error(fs.readFileSync(logPath, 'utf8').split('\n').slice(-45).join('\n'));
  process.exitCode = 1;
});
