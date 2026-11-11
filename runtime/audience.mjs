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
  });
  PASSES.add(pass);
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

  // `item` is a memory item ({ id, label, owner, path }). One the tracker
  // cannot place (no id, no valid label) makes every later egress hold.
  observe(item) {
    if (!item || typeof item.id !== 'string' || !LABELS.includes(item.label)) {
      this.#unresolved += 1;
      return;
    }
    this.#seen.set(item.id, item);
  }

  checkEgress(policy, targetPrincipals) {
    if (this.#unresolved > 0) return { ok: false, hold: 'unresolved', offending: [] };
    if (!Array.isArray(targetPrincipals)) return { ok: false, hold: 'unresolved', offending: [] };
    const offending = [...this.#seen.values()]
      .filter((item) => !canReadAll(policy, targetPrincipals, item))
      .map((item) => item.id);
    return offending.length === 0 ? { ok: true } : { ok: false, hold: 'audience', offending };
  }
}
