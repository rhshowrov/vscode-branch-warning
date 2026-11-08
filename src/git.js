'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const MAX_LOG_BYTES = 256 * 1024;

async function git(cwd, args, executable = 'git') {
  const { stdout } = await run(executable, ['--no-optional-locks', ...args], {
    cwd, encoding: 'utf8', timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, windowsHide: true,
  });
  return stdout.trimEnd();
}

async function optionalText(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return ''; throw error; }
}

/** Read only a bounded tail. Byte offsets distinguish identical entries within one second. */
async function readReflog(file) {
  let handle;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    const start = Math.max(0, size - MAX_LOG_BYTES);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const entries = [];
    let offset = start > 0 ? buffer.indexOf(10) + 1 : 0;
    if (start > 0 && offset === 0) return entries;
    while (offset < bytesRead) {
      const end = buffer.indexOf(10, offset);
      if (end < 0 || end >= bytesRead) break; // A concurrent append may be incomplete.
      const raw = buffer.toString('utf8', offset, end);
      const match = raw.match(/^([a-f0-9]+) ([a-f0-9]+) .* (\d+) [+-]\d{4}\t(.*)$/);
      if (match) entries.push({
        id: `${start + offset}:${raw}`, old: match[1], hash: match[2],
        time: Number(match[3]), message: match[4],
      });
      offset = end + 1;
    }
    return entries;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  } finally { await handle?.close(); }
}

class GitRepository {
  constructor(root, gitDir, commonDir, executable) {
    Object.assign(this, { root, gitDir, commonDir, executable });
    this.logCache = new Map();
  }

  async cachedLog(file) {
    try {
      const stat = await fs.stat(file);
      const stamp = `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      const cached = this.logCache.get(file);
      if (cached?.stamp === stamp) return cached.entries;
      const entries = await readReflog(file);
      this.logCache.set(file, { stamp, entries });
      return entries;
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') { this.logCache.delete(file); return []; }
      throw error;
    }
  }

  static async open(folder, executable = 'git') {
    const root = await git(folder, ['rev-parse', '--show-toplevel'], executable);
    const gitDir = await git(root, ['rev-parse', '--absolute-git-dir'], executable);
    const common = await git(root, ['rev-parse', '--git-common-dir'], executable);
    return new GitRepository(root, gitDir, await fs.realpath(path.resolve(root, common)), executable);
  }

  async snapshot() {
    const [headText, refsText, remoteText, headLog, mergeText, mergeMessage] = await Promise.all([
      optionalText(path.join(this.gitDir, 'HEAD')),
      git(this.root, ['for-each-ref', '--format=%(refname)%00%(objectname)', 'refs/heads', 'refs/remotes'], this.executable),
      git(this.root, ['remote'], this.executable),
      this.cachedLog(path.join(this.gitDir, 'logs', 'HEAD')),
      optionalText(path.join(this.gitDir, 'MERGE_HEAD')),
      optionalText(path.join(this.gitDir, 'MERGE_MSG')),
    ]);
    const refs = new Map();
    for (const line of refsText.split('\n')) {
      const [name, hash] = line.split('\0');
      if (name && hash) refs.set(name, hash);
    }
    const names = [...refs.keys()].filter(name => name.startsWith('refs/heads/')).map(name => name.slice(11));
    const branchLogs = new Map(await Promise.all(names.map(async name => [
      name, await this.cachedLog(path.join(this.commonDir, 'logs', 'refs', 'heads', ...name.split('/'))),
    ])));
    const branch = headText.trim().match(/^ref: refs\/heads\/(.+)$/)?.[1];
    return {
      branch, headLog, branchLogs, refs,
      remotes: remoteText.split('\n').filter(Boolean),
      merge: mergeText.trim() ? { hashes: mergeText.trim().split('\n'), message: mergeMessage } : undefined,
    };
  }
}

module.exports = { GitRepository, git, readReflog };
