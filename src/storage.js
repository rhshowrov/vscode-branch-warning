'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

/** Atomic profile-local files keep permanent warnings durable independently of window state. */
class FlagStore {
  constructor(directory) { this.directory = directory; }

  async read(directory, key) {
    try {
      const record = JSON.parse(await fs.readFile(path.join(directory, `${key}.json`), 'utf8'));
      if (record.version !== 1 || !record.flags || typeof record.flags !== 'object' || Array.isArray(record.flags)) {
        throw new Error('Unsupported Branch Warning storage format. Existing saved warnings were not overwritten.');
      }
      return record.flags;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  async load(key) {
    const current = await this.read(this.directory, key);
    if (current) return current;
    // Private builds may change publisher ID. Import only this repository's versioned
    // warning record from sibling profiles with the same extension name.
    if (!path.basename(this.directory).endsWith('.branch-warning')) return {};
    const parent = path.dirname(this.directory);
    let siblings;
    try { siblings = await fs.readdir(parent, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
    const imported = {};
    let found = false;
    for (const sibling of siblings) {
      if (!sibling.isDirectory() || !sibling.name.endsWith('.branch-warning') || sibling.name === path.basename(this.directory)) continue;
      const previous = await this.read(path.join(parent, sibling.name), key);
      if (previous) { Object.assign(imported, previous); found = true; }
    }
    if (found) await this.save(key, imported);
    return imported;
  }

  async save(key, flags) {
    await fs.mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, `${key}.json`);
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, flags }, null, 2), { encoding: 'utf8', mode: 0o600, flush: true });
      await fs.rename(temporary, file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}

module.exports = { FlagStore };
