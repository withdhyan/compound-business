import { promises as fs, realpathSync } from 'node:fs';
import path from 'node:path';

import { safeDataPath } from './safe-path.mjs';
import {
  isPlainObject,
  requiredString,
} from './kernel.mjs';
import {
  UNIT_TRANSITIONS,
  assertCompanyKind,
  assertCompanyRecordShape,
  isGrantLive,
  kindForRecordId,
} from './records.mjs';

// Mutations are serialized per resolved dataDir, not per store instance, so two
// stores pointed at the same directory cannot race each other's liveness
// checks. Cross-process serialization is the daemon's lock, not this module's.
const MUTATION_QUEUES = new Map();

function serializeByDataDir(dataDir, operation) {
  const key = queueKey(dataDir);
  const previous = MUTATION_QUEUES.get(key) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  MUTATION_QUEUES.set(key, run.then(
    () => undefined,
    () => undefined,
  ));
  return run;
}

function queueKey(dataDir) {
  const resolved = path.resolve(dataDir);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

// Business state lives here and only here: hash-named records under
// <dataDir>/company/<kind>/ (hash-named), bitemporal fields, supersession instead
// of mutation. The store is constructed with an injected dataDir; production
// passes safeDataPath(ROOT, 'data'), tests pass a temp dir.
//
// Invariants enforced here, not just in the builders:
//   - a record's id is a kind-prefixed hash and nothing else (no paths);
//   - a record's body passes its kind's shape check;
//   - at most one live record per (kind, dedupeKey);
//   - successors go through supersedeRecord only, are live, name a live
//     predecessor, and follow the unit state machine's edges;
//   - mutations are serialized per store, so concurrent calls cannot race the
//     liveness checks (cross-process serialization is the daemon's lock, not
//     this module's).
// On a crash between the two supersession writes the predecessor is closed
// first, so a torn write degrades to silence (no live record), never to two
// live records.
export class CompanyStore {
  constructor(options = {}) {
    if (!isPlainObject(options)) {
      throw new Error('CompanyStore options must be a plain object');
    }
    this.dataDir = path.resolve(options.dataDir ?? path.join(process.cwd(), 'data'));
  }

  async writeRecord(record) {
    return serializeByDataDir(this.dataDir, async () => {
      const value = assertCompanyRecordShape(record);
      if (value.supersedes) {
        throw new Error('successors go through supersedeRecord');
      }
      if (value.kind === 'BusinessUnit' && value.state !== 'planned') {
        throw new Error('a first unit record must be planned');
      }
      const live = await this.liveRecords(value.kind);
      if (live.some((candidate) => candidate.dedupeKey === value.dedupeKey)) {
        throw new Error(
          `a live ${value.kind} already exists for ${value.dedupeKey}; supersede it instead`,
        );
      }
      await this.#writeFile(value);
      return value;
    });
  }

  async readRecord(id) {
    const kind = kindForRecordId(id);
    const file = this.#file(kind, id);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    if (parsed?.kind !== kind || parsed?.id !== id) {
      throw new Error(`company store: ${id} does not match the record on disk`);
    }
    return parsed;
  }

  async listRecords(kind) {
    assertCompanyKind(kind);
    const dir = safeDataPath(this.dataDir, path.join('company', kind));
    let entries;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const parsed = JSON.parse(await fs.readFile(path.join(dir, entry), 'utf8'));
      if (parsed.kind !== kind) {
        throw new Error(`company store: ${entry} is ${parsed.kind}, not ${kind}`);
      }
      records.push(parsed);
    }
    return records.sort(
      (left, right) =>
        (left.ingestedAt ?? '').localeCompare(right.ingestedAt ?? '') ||
        (left.id ?? '').localeCompare(right.id ?? ''),
    );
  }

  async liveRecords(kind) {
    return (await this.listRecords(kind)).filter(isLiveRecord);
  }

  async supersedeRecord(predecessorId, successor) {
    return serializeByDataDir(this.dataDir, async () => {
      const predecessor = await this.readRecord(predecessorId);
      if (!predecessor) {
        throw new Error(`no company record: ${predecessorId}`);
      }
      if (!isLiveRecord(predecessor)) {
        throw new Error(`company record is not live: ${predecessorId}`);
      }
      const next = assertCompanyRecordShape(successor);
      if (next.kind !== predecessor.kind) {
        throw new Error('a successor must keep the predecessor kind');
      }
      if (next.dedupeKey !== predecessor.dedupeKey) {
        throw new Error('a successor must keep the predecessor dedupeKey');
      }
      if (next.supersedes !== predecessor.id) {
        throw new Error('successor.supersedes must name the predecessor');
      }
      if (next.id === predecessor.id) {
        throw new Error('a successor cannot reuse the predecessor id');
      }
      if (!isLiveRecord(next)) {
        throw new Error('a successor must be live');
      }
      if (Date.parse(next.validFrom) <= Date.parse(predecessor.validFrom)) {
        throw new Error('successor validFrom must be after the predecessor validFrom');
      }
      if (next.kind === 'BusinessUnit') {
        const allowed = UNIT_TRANSITIONS[predecessor.state] ?? [];
        if (!allowed.includes(next.state)) {
          throw new Error(`unit history refuses ${predecessor.state} → ${next.state}`);
        }
        for (const field of [
          'title',
          'stage',
          'goal',
          'evidence',
          'verification',
          'killCriterion',
          'ownerRole',
          'reviewRole',
          'authorityClass',
        ]) {
          if (JSON.stringify(next[field]) !== JSON.stringify(predecessor[field])) {
            throw new Error(`a unit successor cannot change ${field}`);
          }
        }
        if ((next.actionScope ?? null) !== (predecessor.actionScope ?? null)) {
          throw new Error('a unit successor cannot change actionScope');
        }
        if (
          next.state === 'approved' &&
          (next.authorityClass === 'reversible' || next.authorityClass === 'irreversible')
        ) {
          const grant = await this.readRecord(requiredString(next.grantId, 'grantId'));
          if (!grant || grant.kind !== 'AuthorityGrant' || !isGrantLive(grant, next.validFrom)) {
            throw new Error('unit approval needs a live grant record');
          }
          if (
            grant.actionClass !== next.authorityClass ||
            grant.scope !== next.actionScope ||
            grant.role !== next.approvedBy
          ) {
            throw new Error('the approval grant does not match the unit');
          }
        }
      }
      if (next.kind === 'AuthorityGrant') {
        if (next.spent < predecessor.spent) {
          throw new Error('a grant successor cannot lower spent');
        }
        for (const field of ['role', 'scope', 'actionClass', 'budget', 'grantedBy', 'expiresAt']) {
          if (JSON.stringify(next[field]) !== JSON.stringify(predecessor[field])) {
            throw new Error(`a grant successor cannot change ${field}`);
          }
        }
      }
      const live = await this.liveRecords(predecessor.kind);
      if (live.some((candidate) => candidate.dedupeKey === predecessor.dedupeKey && candidate.id !== predecessor.id)) {
        throw new Error(`another live ${predecessor.kind} already owns ${predecessor.dedupeKey}`);
      }
      if (await fileExists(this.#file(next.kind, next.id))) {
        throw new Error(`successor already exists: ${next.id}`);
      }

      // Close first: a crash here leaves no live record (silence), never two.
      const closed = {
        ...predecessor,
        validTo: next.validFrom,
        supersededById: next.id,
      };
      await fs.writeFile(this.#file(predecessor.kind, predecessor.id), serialize(closed), 'utf8');
      try {
        await this.#writeFile(next);
      } catch (error) {
        throw new Error(
          `supersession wrote the closure but not the successor (${predecessor.id} → ${next.id}): ${error.message}`,
        );
      }
      return { predecessor: closed, successor: next };
    });
  }

  async #writeFile(record) {
    const file = this.#file(record.kind, record.id);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(file, serialize(record), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') {
        throw new Error(`company record already exists: ${record.id}`);
      }
      throw error;
    }
    return record;
  }

  #file(kind, id) {
    return safeDataPath(this.dataDir, path.join('company', kind, `${id}.json`));
  }
}

export function isLiveRecord(record) {
  return Boolean(record) && !record.validTo && !record.supersededById;
}

export function createCompanyStore(options = {}) {
  return new CompanyStore(options);
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}
