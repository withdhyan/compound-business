import { promises as fs } from 'node:fs';
import path from 'node:path';

import { isPlainObject, optionalString, requiredString } from './kernel.mjs';

// Who may read what, and who holds founder authority. One policy object,
// loaded once and passed down; nothing here reads the network.
//
//   labels      public < team < founders < personal. Every memory item carries
//               exactly one; an item with no valid label is unreadable.
//   principals  humans and agents -> the highest label they may read.
//   founders    principals who may grant authority and decide levers.
//   owner       the one founder who owns `personal` items by default. A
//               `personal` item is readable only by its owner, whatever the
//               principal's grant says.
//   externals   outside people (an artist): name -> share list of item ids or
//               paths. They read public plus shared team items, never a tier.
//   stages      optional ladder (see stage.mjs); absent = the revenue ladder.
export const LABELS = Object.freeze(['public', 'team', 'founders', 'personal']);

export function normalizeLabel(value) {
  const label = requiredString(value, 'label').toLowerCase();
  if (!LABELS.includes(label)) throw new Error(`invalid label: ${label}`);
  return label;
}

export function buildPolicy(input = {}) {
  if (!isPlainObject(input)) throw new Error('policy must be a plain object');
  const founders = (input.founders ?? []).map((name) => requiredString(name, 'founder'));
  if (founders.length === 0) throw new Error('policy needs at least one founder');
  // An owner that was never written down is not an owner: with several
  // founders, ownerless personal items stay unreadable rather than follow
  // whoever is listed first.
  const ownerExplicit = input.owner !== undefined || founders.length === 1;
  const owner = requiredString(input.owner ?? founders[0], 'owner');
  if (!founders.includes(owner)) throw new Error('policy owner must be a founder');
  if (!isPlainObject(input.principals)) throw new Error('policy needs a principals map');
  const principals = {};
  for (const [name, label] of Object.entries(input.principals)) {
    principals[requiredString(name, 'principal')] = normalizeLabel(label);
  }
  for (const founder of founders) {
    if (!principals[founder]) throw new Error(`founder ${founder} needs a grant`);
    if (LABELS.indexOf(principals[founder]) < LABELS.indexOf('founders')) {
      throw new Error(`founder ${founder} needs a grant of at least founders`);
    }
  }
  const externals = {};
  for (const [name, share] of Object.entries(input.externals ?? {})) {
    requiredString(name, 'external');
    if (Object.hasOwn(principals, name)) throw new Error(`${name} is both a principal and an external`);
    if (!Array.isArray(share)) throw new Error(`external ${name} needs a share list`);
    externals[name] = Object.freeze(share.map((entry) => requiredString(entry, 'share entry')));
  }
  const stages = input.stages === undefined ? null : buildStages(input.stages);
  return Object.freeze({
    owner,
    ownerExplicit,
    founders: Object.freeze([...founders]),
    principals: Object.freeze(principals),
    externals: Object.freeze(externals),
    stages,
    stageNames: stages ? Object.freeze(stages.map((stage) => stage.name)) : null,
  });
}

function buildStages(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('policy stages must be a non-empty array');
  }
  const seen = new Set();
  return Object.freeze(value.map((raw, index) => {
    if (!isPlainObject(raw)) throw new Error(`stage ${index + 1} must be an object`);
    const name = requiredString(raw.name, 'stage name').toLowerCase();
    if (seen.has(name)) throw new Error(`duplicate stage: ${name}`);
    seen.add(name);
    const exitCriteria = Array.isArray(raw.exitCriteria)
      ? raw.exitCriteria.map((entry) => requiredString(entry, 'exit criterion'))
      : [];
    if (exitCriteria.length === 0) throw new Error(`stage ${name} needs exit criteria`);
    return Object.freeze({
      name,
      index,
      bindingConstraint: requiredString(raw.bindingConstraint, 'bindingConstraint'),
      exitCriteria: Object.freeze(exitCriteria),
    });
  }));
}

// One founder, one owner: what the runtime assumed before policies existed.
export const DEFAULT_POLICY = buildPolicy({
  owner: 'founder',
  founders: ['founder'],
  principals: { founder: 'personal' },
});

export function isFounderPrincipal(name, policy = DEFAULT_POLICY) {
  return typeof name === 'string' && policy.founders.includes(name);
}

// `item` ({ id, path }) is only consulted for externals. An external has no
// tier: public items, plus public/team items on its share list (by id or
// path). Sharing never lifts a founders or personal item.
export function canRead(policy, principal, label, itemOwner, item) {
  if (typeof principal === 'string' && Object.hasOwn(policy.externals, principal)) {
    if (label === 'public') return true;
    if (label !== 'team' || !item) return false;
    const share = policy.externals[principal];
    return share.includes(item.id) || share.includes(item.path);
  }
  if (typeof principal !== 'string' || !Object.hasOwn(policy.principals, principal)) return false;
  if (typeof label !== 'string' || !LABELS.includes(label)) return false;
  if (LABELS.indexOf(label) > LABELS.indexOf(policy.principals[principal])) return false;
  if (label === 'personal') {
    const owner = optionalString(itemOwner) ?? (policy.ownerExplicit ? policy.owner : undefined);
    return owner !== undefined && principal === owner;
  }
  return true;
}

export async function loadPolicy(file, mustExist = false) {
  let raw;
  try {
    raw = await fs.readFile(path.resolve(file), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' && !mustExist) return DEFAULT_POLICY;
    throw error;
  }
  return buildPolicy(JSON.parse(raw));
}
