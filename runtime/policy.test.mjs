import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_POLICY,
  LABELS,
  buildPolicy,
  canRead,
  isFounderPrincipal,
  normalizeLabel,
} from './policy.mjs';

test('labels are a closed ordered set', () => {
  assert.deepEqual([...LABELS], ['public', 'team', 'founders', 'personal']);
  assert.equal(normalizeLabel(' Team '), 'team');
  assert.throws(() => normalizeLabel('secret'), /invalid label/);
  assert.throws(() => normalizeLabel(undefined), /label is required/);
});

test('the default policy keeps one owner and one founder', () => {
  assert.equal(DEFAULT_POLICY.owner, 'founder');
  assert.ok(isFounderPrincipal('founder', DEFAULT_POLICY));
  assert.ok(!isFounderPrincipal('cofounder', DEFAULT_POLICY));
  assert.ok(canRead(DEFAULT_POLICY, 'founder', 'personal'));
});

test('unlabelled and unknown principals read nothing', () => {
  assert.ok(!canRead(DEFAULT_POLICY, 'founder', undefined));
  assert.ok(!canRead(DEFAULT_POLICY, 'founder', 'bogus'));
  assert.ok(!canRead(DEFAULT_POLICY, 'stranger', 'public'));
  assert.ok(!canRead(DEFAULT_POLICY, undefined, 'public'));
});

test('grants are a ceiling per principal; personal is owner-only', () => {
  const policy = buildPolicy({
    owner: 'founder',
    founders: ['founder', 'cofounder'],
    principals: { founder: 'personal', cofounder: 'personal', 'guest-artist': 'team', bot: 'public' },
  });
  assert.ok(canRead(policy, 'guest-artist', 'public'));
  assert.ok(canRead(policy, 'guest-artist', 'team'));
  assert.ok(!canRead(policy, 'guest-artist', 'founders'));
  assert.ok(canRead(policy, 'bot', 'public'));
  assert.ok(!canRead(policy, 'bot', 'team'));
  assert.ok(canRead(policy, 'cofounder', 'founders'));
  // personal: only the item's owner (default: the policy owner), even with a max grant
  assert.ok(canRead(policy, 'founder', 'personal'));
  assert.ok(!canRead(policy, 'cofounder', 'personal'));
  assert.ok(canRead(policy, 'cofounder', 'personal', 'cofounder'));
  assert.ok(!canRead(policy, 'founder', 'personal', 'cofounder'));
  assert.ok(!canRead(policy, 'guest-artist', 'personal', 'guest-artist'));
});

test('a founder list replaces the single-founder literal', () => {
  const policy = buildPolicy({
    owner: 'founder',
    founders: ['founder', 'cofounder'],
    principals: { founder: 'personal', cofounder: 'founders' },
  });
  assert.ok(isFounderPrincipal('cofounder', policy));
  assert.ok(!isFounderPrincipal('guest-artist', policy));
});

test('policy is validated and frozen', () => {
  assert.throws(() => buildPolicy({ owner: 'x', founders: ['y'], principals: { y: 'personal' } }), /owner must be a founder/);
  assert.throws(() => buildPolicy({ owner: 'a', founders: ['a'], principals: {} }), /founder a needs a grant/);
  assert.throws(() => buildPolicy({ owner: 'a', founders: ['a'], principals: { a: 'team' } }), /founder a needs a grant of at least founders/);
  assert.throws(() => buildPolicy({ owner: 'a', founders: ['a'], principals: { a: 'weird' } }), /invalid label/);
  assert.throws(() => buildPolicy({ owner: 'a', founders: [], principals: { a: 'personal' } }), /at least one founder/);
  assert.ok(Object.isFrozen(DEFAULT_POLICY));
});

test('stages load from policy; names must be unique and have exit criteria', () => {
  const policy = buildPolicy({
    owner: 'founder',
    founders: ['founder'],
    principals: { founder: 'personal' },
    stages: [
      { name: 'measures', bindingConstraint: 'a signed partner', exitCriteria: ['partner_signed'] },
      { name: 'k_loop', bindingConstraint: 'a measured loop', exitCriteria: ['loop_metric'] },
    ],
  });
  assert.deepEqual([...policy.stageNames], ['measures', 'k_loop']);
  assert.throws(() => buildPolicy({ founders: ['f'], owner: 'f', principals: { f: 'personal' }, stages: [] }), /stages/);
  assert.throws(() => buildPolicy({
    founders: ['f'], owner: 'f', principals: { f: 'personal' },
    stages: [{ name: 'a', bindingConstraint: 'x', exitCriteria: ['c'] }, { name: 'a', bindingConstraint: 'x', exitCriteria: ['c'] }],
  }), /duplicate stage/);
  assert.throws(() => buildPolicy({
    founders: ['f'], owner: 'f', principals: { f: 'personal' },
    stages: [{ name: 'a', bindingConstraint: 'x', exitCriteria: [] }],
  }), /exit criteria/);
});

test('an external principal has no tier: public plus an explicit per-item share', () => {
  const policy = buildPolicy({
    owner: 'f', founders: ['f'], principals: { f: 'personal' },
    externals: { artist: ['mem_0123456789abcdef', 'memory/brand/kit.md'] },
  });
  const read = (label, item) => canRead(policy, 'artist', label, undefined, item);
  assert.ok(read('public', { id: 'mem_aaaaaaaaaaaaaaaa', path: 'memory/x.md' }));
  assert.ok(read('team', { id: 'mem_0123456789abcdef', path: 'memory/y.md' }));
  assert.ok(read('team', { id: 'mem_aaaaaaaaaaaaaaaa', path: 'memory/brand/kit.md' }));
  assert.ok(!read('team', { id: 'mem_aaaaaaaaaaaaaaaa', path: 'memory/y.md' }));
  assert.ok(!read('team', undefined));
  // sharing never lifts founders or personal items
  assert.ok(!read('founders', { id: 'mem_0123456789abcdef', path: 'memory/y.md' }));
  assert.ok(!read('personal', { id: 'mem_0123456789abcdef', path: 'memory/y.md' }));
  assert.ok(!read(undefined, { id: 'mem_0123456789abcdef', path: 'memory/y.md' }));
  assert.ok(!isFounderPrincipal('artist', policy));
  assert.throws(() => buildPolicy({
    owner: 'f', founders: ['f'], principals: { f: 'personal' }, externals: { f: [] },
  }), /both a principal and an external/);
  assert.throws(() => buildPolicy({
    owner: 'f', founders: ['f'], principals: { f: 'personal' }, externals: { a: 'x' },
  }), /share list/);
});
