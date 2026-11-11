import { GUEST_PREFIX, LABELS, canRead, normalizeLabel } from './policy.mjs';

// Audience-scoped reads. A conversation has an audience (the people in the
// room); what an agent may say or read there is what EVERY member may read:
// the reader-set lattice of buzz ifc-core, expressed over the label policy.
//
//   principalsFor  pubkeys -> principals. Unmapped = guest (public only).
//                  Our own agents' pubkeys are not part of the audience.
//   canReadAll     AND over members, through the one canRead.
//   passFor        a read pass for memory.mjs, clamped by a zone ceiling.
//   FlowTracker    what the turn has read; may it go out to this audience.
//
// An empty audience reads public only: no member can be the check that
// narrows, so the floor is the most open label, never the most open reader.

const PASSES = new WeakSet();

export function principalsFor(policy, pubkeys) {
  if (!Array.isArray(pubkeys)) throw new Error('pubkeys must be an array');
  const out = [];
  for (const raw of pubkeys) {
    const key = String(raw).toLowerCase();
    if (policy.agents.includes(key)) continue;
    const name = Object.hasOwn(policy.pubkeys, key) ? policy.pubkeys[key] : `${GUEST_PREFIX}${key}`;
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

export function canReadAll(policy, principals, item) {
  if (!Array.isArray(principals) || !item) return false;
  const read = (principal) => canRead(policy, principal, item.label, item.owner, item);
  if (principals.length === 0) return item.label === 'public';
  return principals.every(read);
}

export function passFor(policy, principals, zoneCeiling) {
  if (!Array.isArray(principals)) throw new Error('principals must be an array');
  const ceiling = normalizeLabel(zoneCeiling);
  const pass = Object.freeze({
    kind: 'pass',
    name: principals.length ? principals.join('+') : 'public',
    members: Object.freeze([...principals]),
    ceiling,
    issuedAt: Date.now(),
  });
  PASSES.add(pass);
  return pass;
}

// At post time the audience is re-resolved; a pass older than maxAgeMs (or
// from the future) is not good enough.
export function requireFresh(pass, maxAgeMs, now = Date.now()) {
  if (!isPass(pass)) throw new Error('audience unresolved');
  const age = now - pass.issuedAt;
  if (!(Number.isFinite(maxAgeMs) && age >= 0 && age <= maxAgeMs)) throw new Error('audience stale');
  return pass;
}

export const isPass = (value) => PASSES.has(value);

// The one question memory.mjs asks of a pass.
export function passCanRead(policy, pass, item) {
  if (!item?.label || LABELS.indexOf(item.label) > LABELS.indexOf(pass.ceiling)) return false;
  return canReadAll(policy, pass.members, item);
}

export class FlowTracker {
  #seen = new Map();
  #unresolved = 0;

  // `item` is what a read returned ({ id, label, owner, path }). Nothing is
  // ever replaced: each distinct (id, label, owner, path) is kept as a frozen
  // copy, so a later look-alike cannot clear an earlier observation. One the
  // tracker cannot place holds every later egress: no id, no valid label, or
  // a personal item whose owner the view did not carry.
  observe(item) {
    if (!resolvable(item)) {
      this.#unresolved += 1;
      return;
    }
    const copy = copyOf(item);
    this.#seen.set(JSON.stringify([copy.id, copy.label, copy.owner, copy.path]), copy);
  }

  // `cited` are ids the output names; `resolve(id)` returns the item for one
  // (or nothing). An id that does not resolve holds.
  checkEgress(policy, targetPrincipals, { cited = [], resolve } = {}) {
    if (this.#unresolved > 0 || !Array.isArray(targetPrincipals) || !Array.isArray(cited)) {
      return { ok: false, hold: 'unresolved', offending: [] };
    }
    const items = [...this.#seen.values()];
    for (const id of cited) {
      let found;
      try {
        found = typeof resolve === 'function' ? resolve(id) : undefined;
      } catch {
        found = undefined;
      }
      if (!resolvable(found) || found.id !== id) return { ok: false, hold: 'unresolved', offending: [] };
      items.push(copyOf(found));
    }
    const offending = [...new Set(items.filter((item) => !canReadAll(policy, targetPrincipals, item)).map((item) => item.id))];
    return offending.length === 0 ? { ok: true } : { ok: false, hold: 'audience', offending };
  }
}

function resolvable(item) {
  if (!item || typeof item.id !== 'string' || !LABELS.includes(item.label)) return false;
  return item.label !== 'personal' || typeof item.owner === 'string';
}

const copyOf = (item) => Object.freeze({ id: item.id, label: item.label, owner: item.owner ?? null, path: item.path ?? null });
