'use strict';

function newEntries(previous = [], current = [], isNewBranch = false) {
  if (!previous.length) return isNewBranch ? current : [];
  const last = previous.at(-1).id;
  const index = current.findIndex(entry => entry.id === last);
  // An expired/rewritten reflog is not evidence of new activity. Do not replay its history.
  return index >= 0 ? current.slice(index + 1) : [];
}

function normalizeRef(ref, remotes = []) {
  let name = ref.trim().replace(/^['"]|['"]$/g, '').replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
  for (const remote of remotes) {
    if (name.startsWith(`${remote}/`)) { name = name.slice(remote.length + 1); break; }
  }
  return name;
}

/** Classifies only observed operations; existing history is a baseline, never a backfill. */
class BranchTracker {
  constructor(saved = {}) {
    this.flags = new Map(Object.entries(saved).filter(([, flag]) => flag && typeof flag.reason === 'string'));
    this.previous = undefined;
    this.pendingRebase = undefined;
    this.pendingMerge = undefined;
  }

  serialize() { return Object.fromEntries(this.flags); }

  baseline(snapshot) {
    // Preserve a known warning through a rename, including one performed while the editor was closed.
    for (const [branch, log] of snapshot.branchLogs) {
      for (const entry of log) this.transferRename(branch, entry.message);
    }
    this.removeDeleted(snapshot);
    this.previous = snapshot;
  }

  transferRename(branch, message) {
    const renamed = message.match(/^Branch: renamed refs\/heads\/(.+) to refs\/heads\/(.+)$/);
    if (renamed && renamed[2] === branch && this.flags.has(renamed[1])) {
      this.flags.set(branch, this.flags.get(renamed[1]));
      this.flags.delete(renamed[1]);
    }
  }

  removeDeleted(snapshot) {
    for (const name of this.flags.keys()) {
      if (!snapshot.branchLogs.has(name)) this.flags.delete(name);
    }
  }

  update(snapshot, rules) {
    if (!this.previous) { this.baseline(snapshot); return this.serialize(); }
    const previous = this.previous;
    const forbidden = ref => rules.forbiddenBranches.includes(normalizeRef(ref, snapshot.remotes));
    const flagPoints = new Map();
    const mark = (branch, reason, source, point) => {
      if (branch && !this.flags.has(branch)) {
        this.flags.set(branch, { reason, source, detectedAt: new Date().toISOString() });
        flagPoints.set(branch, point);
      } else if (flagPoints.has(branch) && point?.creation) {
        // Creation precedes any later merge/rebase on this same branch.
        flagPoints.set(branch, point);
      }
    };
    const headEvents = newEntries(previous.headLog, snapshot.headLog);
    const pointFor = (entry, creation = false) => ({
      ...entry, creation,
      order: headEvents.findIndex(event => event.message === entry.message && event.old === entry.old && event.hash === entry.hash),
    });
    const dangerousAtCreation = (source, creation) => {
      const name = normalizeRef(source, snapshot.remotes);
      if (forbidden(source)) return true;
      if (!this.flags.has(name)) return false;
      if (!flagPoints.has(name)) return true; // Already flagged before this check interval.
      const point = flagPoints.get(name);
      if (point?.creation) return true; // The parent has been red since it came into existence.
      if (point?.order >= 0 && creation.order >= 0) return point.order < creation.order;
      if (point && creation.time > point.time) return true;
      // A non-checkout branch command can still name the newly merged/rebased tip exactly.
      return Boolean(point && creation.hash === point.hash && point.hash !== point.old);
    };
    const deltas = new Map();
    for (const [branch, log] of snapshot.branchLogs) {
      const rename = log.findLast(entry => entry.message.startsWith('Branch: renamed '));
      const oldName = rename?.message.match(/^Branch: renamed refs\/heads\/(.+) to /)?.[1];
      const oldLog = previous.branchLogs.get(branch) || (oldName && previous.branchLogs.get(oldName));
      const entries = newEntries(oldLog, log, !oldLog);
      deltas.set(branch, entries);
      for (const entry of entries) this.transferRename(branch, entry.message);
    }

    let headBranch = previous.branch;
    for (const entry of headEvents) {
      const checkout = entry.message.match(/^checkout: moving from (.+) to (.+)$/);
      if (checkout) headBranch = checkout[2];
      const renamed = entry.message.match(/^Branch: renamed refs\/heads\/(.+) to refs\/heads\/(.+)$/);
      if (renamed) headBranch = renamed[2];
      const start = entry.message.match(/^rebase \(start\): checkout (.+)$/);
      if (start) this.pendingRebase = { branch: headBranch, source: normalizeRef(start[1], snapshot.remotes), forbidden: forbidden(start[1]) };
      const finish = entry.message.match(/^rebase \(finish\): returning to refs\/heads\/(.+)$/);
      if (finish) {
        if (this.pendingRebase?.forbidden) mark(finish[1], 'Rebased onto a forbidden branch', this.pendingRebase.source, pointFor(entry));
        headBranch = finish[1];
        this.pendingRebase = undefined;
      }
      if (entry.message.startsWith('rebase (abort):')) this.pendingRebase = undefined;
    }

    // Iterate so multiple branches created between polls inherit warnings in parent order.
    let added;
    do {
      const count = this.flags.size;
      for (const [branch, entries] of deltas) {
        for (const entry of entries) {
          const created = entry.message.match(/^branch: Created from (.+)$/);
          if (created) {
            let source = created[1];
            const checkout = headEvents.find(event => {
              const match = event.message.match(/^checkout: moving from (.+) to (.+)$/);
              return match?.[2] === branch && event.hash === entry.hash && event.time >= entry.time;
            });
            const creationPoint = { ...pointFor(entry, true), order: checkout ? headEvents.indexOf(checkout) : -1 };
            if (source === 'HEAD' || source === '@') {
              if (checkout) source = checkout.message.match(/^checkout: moving from (.+) to /)[1];
              else if (previous.branch === snapshot.branch &&
                !headEvents.some(event => /^(checkout:|rebase |Branch: renamed )/.test(event.message)) &&
                [previous.headLog.at(-1), ...headEvents].some(event => event?.hash === entry.hash)) {
                source = previous.branch || 'HEAD';
              } else source = ''; // A hash alone does not establish which named branch was used.
            }
            if (source && dangerousAtCreation(source, creationPoint)) {
              mark(branch, forbidden(source) ? 'Created from a forbidden branch' : 'Created from a permanently flagged branch', normalizeRef(source, snapshot.remotes), creationPoint);
            }
          }
          const merge = entry.message.match(/^merge (.+?):/);
          if (merge) {
            const source = merge[1].split(/\s+/).find(forbidden);
            if (source) mark(branch, 'Merged a forbidden branch', normalizeRef(source, snapshot.remotes), pointFor(entry));
          }
          const pull = entry.message.match(/^pull (.+?):/);
          if (pull) {
            const words = pull[1].split(/\s+/);
            const remoteIndex = words.findIndex(word => snapshot.remotes.includes(word));
            const source = remoteIndex >= 0 ? words.slice(remoteIndex + 1).find(forbidden) : undefined;
            if (source) mark(branch, 'Merged a forbidden branch through git pull', normalizeRef(source, snapshot.remotes), pointFor(entry));
          }
          if (entry.message.startsWith('commit (merge):')) {
            const source = entry.message.match(/Merge (?:remote-tracking )?branch ['"]([^'"]+)['"]/)?.[1];
            if (source && forbidden(source)) mark(branch, 'Merged a forbidden branch', normalizeRef(source, snapshot.remotes), pointFor(entry));
            if (this.pendingMerge?.branch === branch) mark(branch, 'Merged a forbidden branch', this.pendingMerge.source, pointFor(entry));
          }
        }
      }
      added = count !== this.flags.size;
    } while (added);

    if (snapshot.merge && snapshot.branch) {
      const source = snapshot.merge.message.match(/Merge (?:remote-tracking )?branch ['"]([^'"]+)['"]/)?.[1];
      this.pendingMerge = source && forbidden(source) ? { branch: snapshot.branch, source: normalizeRef(source, snapshot.remotes) } : undefined;
    } else this.pendingMerge = undefined;

    this.removeDeleted(snapshot);
    this.previous = snapshot;
    return this.serialize();
  }

  status(snapshot, rules) {
    const branch = snapshot.branch;
    if (!branch) return { kind: 'detached', branch: undefined };
    if (rules.viewOnlyBranches.includes(branch)) return { kind: 'viewOnly', branch };
    if (rules.forbiddenBranches.includes(branch)) return { kind: 'forbidden', branch };
    const flag = this.flags.get(branch);
    return flag ? { kind: 'flagged', branch, ...flag } : { kind: 'normal', branch };
  }
}

module.exports = { BranchTracker, normalizeRef, newEntries };
