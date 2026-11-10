import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildAuthorityGrant } from './records.mjs';
import { createCompanyStore } from './store.mjs';
import {
  applyGrantSpend,
  authorizeAction,
  authorizeAndSpend,
  authorizeStoredAction,
  isGrantLive,
  remainingBudget,
} from './ladder.mjs';

const at = '2026-09-22T10:00:00.000Z';
const now = () => new Date(at);

function grant(overrides = {}) {
  return buildAuthorityGrant({
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 500,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
    ...overrides,
  }, now);
}

test('advisory work needs no grant; unknown classes are refused', () => {
  assert.equal(authorizeAction({ actionClass: 'advise', actor: 'gtm', action: 'think', at }).allowed, true);
  assert.equal(authorizeAction({ actionClass: 'draft', actor: 'content', action: 'draft a post', at }).allowed, true);
  assert.throws(
    () => authorizeAction({ actionClass: 'auto', actor: 'gtm', action: 'send', at }),
    /invalid authority class/,
  );
});

test('reversible actions need a live grant for the actor, class, and scope', () => {
  const live = grant();
  const allowed = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 120,
    grants: [live],
    at,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.audit.grantId, live.id);

  const noGrant = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 120,
    grants: [],
    at,
  });
  assert.equal(noGrant.allowed, false);
  assert.match(noGrant.audit.reason, /no live grant/);

  const wrongScope = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ar:refund',
    grants: [live],
    at,
  });
  assert.equal(wrongScope.allowed, false);

  const expired = grant({ expiresAt: '2026-09-01T00:00:00.000Z' });
  assert.equal(isGrantLive(expired, at), false);
  assert.equal(authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    grants: [expired],
    at,
  }).allowed, false);
});

test('a scoped action with no scope is refused, and a grant not issued by the founder never authorizes', () => {
  const scoped = grant({ scope: 'ar:refund' });
  assert.throws(
    () => authorizeAction({
      actionClass: 'reversible',
      actor: 'money',
      action: 'pay ap invoice',
      grants: [scoped],
      at,
    }),
    /scope/,
  );

  const forged = {
    kind: 'AuthorityGrant',
    id: 'agrant_forged',
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 1_000_000,
    spent: 0,
    expiresAt: '2027-01-01T00:00:00.000Z',
    revokedAt: null,
  };
  assert.equal(isGrantLive(forged, at), false);
  assert.equal(authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 10,
    grants: [forged],
    at,
  }).allowed, false);
});

test('a truthy brake signal stops every non-advisory action', () => {
  const result = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    grants: [grant()],
    at,
    brakeEngaged: 'true',
  });
  assert.equal(result.allowed, false);
  assert.match(result.audit.reason, /emergency brake/);
});

test('the brake stops every non-advisory action', () => {
  const result = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    grants: [grant()],
    at,
    brakeEngaged: true,
  });
  assert.equal(result.allowed, false);
  assert.match(result.audit.reason, /emergency brake/);
  assert.equal(authorizeAction({ actionClass: 'draft', actor: 'money', action: 'draft', at, brakeEngaged: true }).allowed, true);
});

test('spend hard-stops at the budget, and a grant without a ceiling may not spend', () => {
  const tight = grant({ budget: 100 });
  assert.equal(authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 101,
    grants: [tight],
    at,
  }).allowed, false);

  const uncapped = grant({ budget: null });
  const spendAttempt = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 1,
    grants: [uncapped],
    at,
  });
  assert.equal(spendAttempt.allowed, false);
  assert.match(spendAttempt.audit.reason, /no spend ceiling/);
});

test('an allowed spend returns the seed the caller must persist', () => {
  const allowed = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 120,
    grants: [grant()],
    at,
  });
  assert.equal(allowed.allowed, true);
  assert.deepEqual(allowed.spend, { grantId: grant().id, cost: 120, spent: 120, remaining: 380 });
});

test('irreversible actions need a founder receipt on top of a grant', () => {
  const sign = grant({ actionClass: 'irreversible', scope: 'contract:sign' });
  const refused = authorizeAction({
    actionClass: 'irreversible',
    actor: 'money',
    action: 'sign contract',
    scope: 'contract:sign',
    grants: [sign],
    at,
  });
  assert.equal(refused.allowed, false);
  assert.match(refused.audit.reason, /founder receipt/);

  const allowed = authorizeAction({
    actionClass: 'irreversible',
    actor: 'money',
    action: 'sign contract',
    scope: 'contract:sign',
    grants: [sign],
    founderReceiptId: 'card_123',
    at,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.audit.receiptId, 'card_123');
});

test('grant spend math is pure and never crosses the cap', () => {
  const value = grant();
  assert.equal(remainingBudget(value), 500);
  const after = applyGrantSpend(value, 120, at);
  assert.deepEqual(after, { spent: 120, remaining: 380 });
  assert.throws(() => applyGrantSpend(value, 600, at), /cross the budget hard stop/);
  assert.throws(() => applyGrantSpend(value, -1, at), /non-negative/);
  assert.throws(() => applyGrantSpend(grant({ budget: null }), 1, at), /no spend ceiling/);
});

test('stored grants resolve by id; fabricated ids fail closed', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'company-ladder-'));
  const store = createCompanyStore({ dataDir });
  const value = grant();
  await store.writeRecord(value);

  const allowed = await authorizeStoredAction({
    store,
    grantIds: [value.id],
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 10,
    at,
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.audit.grantId, value.id);

  await assert.rejects(
    authorizeStoredAction({
      store,
      grantIds: ['agrant_000000000000000000000000'],
      actionClass: 'reversible',
      actor: 'money',
      action: 'pay invoice',
      scope: 'ap:pay',
      at,
    }),
    /grant not found/,
  );
});

test('non-finite grant spend cannot authorize', () => {
  const broken = { ...grant(), budget: 0, spent: Number.NaN };
  assert.equal(isGrantLive(broken, at), false);
  const result = authorizeAction({
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 50,
    grants: [broken],
    at,
  });
  assert.equal(result.allowed, false);
});

test('a grant cannot authorize before its validFrom, and a duck-typed store is refused', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'company-ladder-'));
  const store = createCompanyStore({ dataDir });
  const future = buildAuthorityGrant({
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 100,
    expiresAt: '2031-01-01T00:00:00.000Z',
    grantedBy: 'founder',
    eventAt: '2030-01-01T00:00:00.000Z',
  }, () => new Date('2030-01-01T00:00:00.000Z'));
  await store.writeRecord(future);
  const early = await authorizeStoredAction({
    store,
    grantIds: [future.id],
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 10,
    at,
  });
  assert.equal(early.allowed, false);

  await assert.rejects(
    authorizeStoredAction({
      store: { readRecord: async () => ({ ...grant(), id: 'agrant_000000000000000000000000' }) },
      grantIds: ['agrant_000000000000000000000000'],
      actionClass: 'reversible',
      actor: 'money',
      action: 'wire funds',
      scope: 'ap:pay',
      cost: 5000,
      at,
    }),
    /needs a CompanyStore/,
  );
});

test('authorizeAndSpend works at the instant the grant becomes valid', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'company-ladder-'));
  const store = createCompanyStore({ dataDir });
  const value = grant({ budget: 100 });
  await store.writeRecord(value);

  const result = await authorizeAndSpend({
    store,
    grantIds: [value.id],
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 10,
    at,
  });
  assert.equal(result.allowed, true);
  assert.equal((await store.readRecord(result.grantId)).spent, 10);
});

test('authorizeAndSpend persists the spend and hard-stops the budget', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'company-ladder-'));
  const store = createCompanyStore({ dataDir });
  const value = grant({ budget: 100 });
  await store.writeRecord(value);

  const first = await authorizeAndSpend({
    store,
    grantIds: [value.id],
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 60,
    at: '2026-09-22T11:00:00.000Z',
  });
  assert.equal(first.allowed, true);
  assert.equal((await store.readRecord(first.grantId)).spent, 60);
  assert.equal((await store.liveRecords('AuthorityGrant')).length, 1);

  const second = await authorizeAndSpend({
    store,
    grantIds: [first.grantId],
    actionClass: 'reversible',
    actor: 'money',
    action: 'pay invoice',
    scope: 'ap:pay',
    cost: 60,
    at: '2026-09-22T12:00:00.000Z',
  });
  assert.equal(second.allowed, false);
  assert.match(second.audit.reason, /budget hard stop/);
  assert.equal((await store.readRecord(first.grantId)).spent, 60);
});

// ---- founder principals ----------------------------------------------------

import { buildPolicy } from './policy.mjs';

const twoFounders = buildPolicy({
  owner: 'founder', founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'founders' },
});

test('a second founder\'s grant authorizes only under a policy that lists them', () => {
  const cofounderGrant = buildAuthorityGrant({
    role: 'money', scope: 'ap:pay', actionClass: 'reversible', budget: 50,
    expiresAt: '2026-10-22T00:00:00.000Z', grantedBy: 'cofounder',
  }, now, twoFounders);
  const input = { actionClass: 'reversible', actor: 'money', action: 'pay', scope: 'ap:pay', at, grants: [cofounderGrant] };
  assert.equal(authorizeAction(input).allowed, false);
  assert.equal(authorizeAction({ ...input, policy: twoFounders }).allowed, true);
});

test('spending keeps the granting founder on the successor grant', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-ladder-'));
  const store = createCompanyStore({ dataDir, policy: twoFounders });
  const cofounderGrant = buildAuthorityGrant({
    role: 'money', scope: 'ap:pay', actionClass: 'reversible', budget: 50,
    expiresAt: '2026-10-22T00:00:00.000Z', grantedBy: 'cofounder',
  }, now, twoFounders);
  await store.writeRecord(cofounderGrant);
  const result = await authorizeAndSpend({
    store, grantIds: [cofounderGrant.id], actionClass: 'reversible', actor: 'money',
    action: 'pay', scope: 'ap:pay', cost: 10, at: '2026-09-22T10:05:00.000Z',
  });
  assert.equal(result.allowed, true);
  assert.equal((await store.readRecord(result.grantId)).grantedBy, 'cofounder');
});
