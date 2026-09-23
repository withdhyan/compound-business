import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildAuthorityGrant, buildBusinessRule, buildBusinessUnit, companyRecordId } from './records.mjs';
import { createCompanyStore, isLiveRecord } from './store.mjs';

const fixedNow = () => new Date('2026-09-22T10:00:00.000Z');

async function tempStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'company-store-'));
  return { dataDir, store: createCompanyStore({ dataDir, now: fixedNow }) };
}

function ruleInput(overrides = {}) {
  return {
    role: 'content',
    statement: 'Never publish on Fridays',
    rationale: 'Replies spike unseen over weekends',
    receiptId: 'audit_1',
    ...overrides,
  };
}

test('records persist as hash-named files under company/<kind>/', async () => {
  const { dataDir, store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);

  const file = path.join(dataDir, 'company', 'BusinessRule', `${rule.id}.json`);
  assert.equal(await fs.readFile(file, 'utf8').then((text) => JSON.parse(text).id), rule.id);

  assert.deepEqual((await store.readRecord(rule.id)).id, rule.id);
  assert.equal((await store.readRecord('brule_000000000000000000000000')), null);
  assert.equal((await store.listRecords('BusinessRule')).length, 1);
  assert.equal((await store.liveRecords('BusinessRule')).length, 1);
});

test('writing the same record twice is refused, not overwritten', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);
  await assert.rejects(() => store.writeRecord(rule), /already exists/);
});

test('supersession closes the predecessor and keeps both readable', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);

  const successor = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'pruned',
    pruneReason: 'An audit showed Friday replies were answered Saturday',
    eventAt: '2026-10-01T10:00:00.000Z',
  }), () => new Date('2026-10-01T10:00:00.000Z'));

  const { predecessor, successor: written } = await store.supersedeRecord(rule.id, successor);
  assert.equal(written.supersedes, rule.id);
  assert.equal(predecessor.validTo, written.validFrom);
  assert.equal(predecessor.supersededById, written.id);
  assert.equal(isLiveRecord(predecessor), false);
  assert.equal(isLiveRecord(written), true);

  const records = await store.listRecords('BusinessRule');
  assert.equal(records.length, 2);
  assert.equal((await store.liveRecords('BusinessRule')).length, 1);
  assert.equal((await store.readRecord(rule.id)).supersededById, written.id);
});

test('supersession refuses mis-bound or stale successors', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);

  const foreignKey = buildBusinessRule(ruleInput({
    statement: 'A different rule entirely',
    supersedes: rule.id,
  }), () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(() => store.supersedeRecord(rule.id, foreignKey), /keep the predecessor dedupeKey/);

  const unbound = buildBusinessRule(ruleInput({
    status: 'pruned',
    pruneReason: 'why',
  }), () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(() => store.supersedeRecord(rule.id, unbound), /must name the predecessor/);

  const stale = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'pruned',
    pruneReason: 'why',
    eventAt: '2026-09-01T00:00:00.000Z',
  }), () => new Date('2026-09-01T00:00:00.000Z'));
  await assert.rejects(() => store.supersedeRecord(rule.id, stale), /must be after the predecessor/);
});

test('a superseded record cannot be superseded again', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);
  const first = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'pruned',
    pruneReason: 'why',
    eventAt: '2026-10-01T10:00:00.000Z',
  }), () => new Date('2026-10-01T10:00:00.000Z'));
  await store.supersedeRecord(rule.id, first);

  const second = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'live',
    eventAt: '2026-10-02T10:00:00.000Z',
  }), () => new Date('2026-10-02T10:00:00.000Z'));
  await assert.rejects(() => store.supersedeRecord(rule.id, second), /not live/);
});

test('units round-trip through the store and the live view', async () => {
  const { store } = await tempStore();
  const unit = buildBusinessUnit({
    title: 'Wedge demand test',
    stage: 'validation',
    goal: 'Prove existing spend on the wedge',
    evidence: ['bdec_1'],
    verification: 'Pre-registered call thresholds met',
    killCriterion: 'A1 <= 2 kills the wedge',
    ownerRole: 'gtm',
    reviewRole: 'analyst',
    authorityClass: 'draft',
  }, fixedNow);
  await store.writeRecord(unit);
  assert.equal((await store.liveRecords('BusinessUnit'))[0].title, 'Wedge demand test');
});

test('a second live record for the same dedupeKey is refused', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);
  const twin = buildBusinessRule(ruleInput({
    supersedes: rule.id,
  }), () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(() => store.writeRecord(twin), /successors go through supersedeRecord/);
  await assert.rejects(
    () => store.writeRecord({ ...twin, id: companyRecordId('BusinessRule', rule.dedupeKey, 'other'), supersedes: undefined }),
    /already exists for/,
  );
});

test('a successor must be live, and validFrom is compared as a time, not a string', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);

  const closed = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'pruned',
    pruneReason: 'x',
    eventAt: '2026-10-01T10:00:00.000Z',
  }), () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(
    () => store.supersedeRecord(rule.id, { ...closed, validTo: '2026-10-05T00:00:00.000Z' }),
    /must be live/,
  );

  const earlier = {
    ...closed,
    validFrom: '2026-09-22T10:00:00.000+02:00',
  };
  await assert.rejects(() => store.supersedeRecord(rule.id, earlier), /must be after the predecessor/);
});

test('readRecord refuses a record whose on-disk identity does not match', async () => {
  const { dataDir, store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);
  const file = path.join(dataDir, 'company', 'BusinessRule', `${rule.id}.json`);
  await fs.writeFile(file, JSON.stringify({ ...rule, kind: 'AuditEntry' }));
  await assert.rejects(() => store.readRecord(rule.id), /does not match the record on disk/);
});

test('the store refuses a first unit record outside planned and illegal history edges', async () => {
  const { store } = await tempStore();
  const shipped = buildBusinessUnit({
    title: 'Wedge demand test',
    stage: 'validation',
    goal: 'Prove existing spend on the wedge',
    evidence: ['bdec_1'],
    verification: 'Pre-registered call thresholds met',
    killCriterion: 'A1 <= 2 kills the wedge',
    ownerRole: 'gtm',
    reviewRole: 'analyst',
    authorityClass: 'draft',
    state: 'shipped',
    reviewer: 'analyst',
    reviewReceiptId: 'audit_review_1',
  }, fixedNow);
  await assert.rejects(() => store.writeRecord(shipped), /first unit record must be planned/);

  const unit = buildBusinessUnit({
    title: 'Wedge demand test',
    stage: 'validation',
    goal: 'Prove existing spend on the wedge',
    evidence: ['bdec_1'],
    verification: 'Pre-registered call thresholds met',
    killCriterion: 'A1 <= 2 kills the wedge',
    ownerRole: 'gtm',
    reviewRole: 'analyst',
    authorityClass: 'draft',
  }, fixedNow);
  await store.writeRecord(unit);
  const jump = buildBusinessUnit({
    title: 'Wedge demand test',
    stage: 'validation',
    goal: 'Prove existing spend on the wedge',
    evidence: ['bdec_1'],
    verification: 'Pre-registered call thresholds met',
    killCriterion: 'A1 <= 2 kills the wedge',
    ownerRole: 'gtm',
    reviewRole: 'analyst',
    authorityClass: 'draft',
    state: 'running',
    dedupeKey: unit.dedupeKey,
    supersedes: unit.id,
  }, () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(() => store.supersedeRecord(unit.id, jump), /unit history refuses planned → running/);
});

test('successors only go through supersedeRecord, and never reuse the predecessor id', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);

  const orphan = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'pruned',
    pruneReason: 'x',
  }), () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(() => store.writeRecord(orphan), /successors go through supersedeRecord/);

  await assert.rejects(
    () => store.supersedeRecord(rule.id, { ...orphan, id: rule.id }),
    /cannot reuse the predecessor id/,
  );
  assert.equal((await store.liveRecords('BusinessRule')).length, 1);
});

test('concurrent writers cannot leave two live records for one dedupeKey', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  const twin = {
    ...rule,
    id: companyRecordId('BusinessRule', rule.dedupeKey, 'twin'),
  };
  const results = await Promise.allSettled([store.writeRecord(rule), store.writeRecord(twin)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await store.liveRecords('BusinessRule')).length, 1);
});

test('concurrent supersessions leave exactly one live successor', async () => {
  const { store } = await tempStore();
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  await store.writeRecord(rule);
  const first = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'pruned',
    pruneReason: 'x',
    eventAt: '2026-10-01T10:00:00.000Z',
  }), () => new Date('2026-10-01T10:00:00.000Z'));
  const second = buildBusinessRule(ruleInput({
    supersedes: rule.id,
    status: 'pruned',
    pruneReason: 'y',
    eventAt: '2026-10-02T10:00:00.000Z',
  }), () => new Date('2026-10-02T10:00:00.000Z'));
  const results = await Promise.allSettled([
    store.supersedeRecord(rule.id, first),
    store.supersedeRecord(rule.id, second),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await store.liveRecords('BusinessRule')).length, 1);
});

test('two stores on one dataDir cannot create two live records', async () => {
  const { dataDir } = await tempStore();
  const a = createCompanyStore({ dataDir });
  const b = createCompanyStore({ dataDir });
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  const twin = {
    ...rule,
    id: companyRecordId('BusinessRule', rule.dedupeKey, 'twin'),
  };
  const results = await Promise.allSettled([a.writeRecord(rule), b.writeRecord(twin)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await a.liveRecords('BusinessRule')).length, 1);
});

test('a unit successor cannot relabel identity or skip approval evidence', async () => {  const { store } = await tempStore();
  const unit = buildBusinessUnit({
    title: 'Sign the data-processing agreement',
    stage: 'validation',
    goal: 'Sign the DPA',
    evidence: ['bdec_1'],
    verification: 'Countersigned copy on file',
    killCriterion: 'No signature by 2026-11-01',
    ownerRole: 'counsel',
    reviewRole: 'chief',
    authorityClass: 'irreversible',
    actionScope: 'contract:sign',
  }, fixedNow);
  await store.writeRecord(unit);

  const relabeled = buildBusinessUnit({
    title: unit.title,
    stage: unit.stage,
    goal: unit.goal,
    evidence: unit.evidence,
    verification: unit.verification,
    killCriterion: unit.killCriterion,
    ownerRole: unit.ownerRole,
    reviewRole: unit.reviewRole,
    authorityClass: 'draft',
    state: 'approved',
    dedupeKey: unit.dedupeKey,
    supersedes: unit.id,
  }, () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(
    () => store.supersedeRecord(unit.id, relabeled),
    /cannot change authorityClass/,
  );

  const noGrant = buildBusinessUnit({
    title: unit.title,
    stage: unit.stage,
    goal: unit.goal,
    evidence: unit.evidence,
    verification: unit.verification,
    killCriterion: unit.killCriterion,
    ownerRole: unit.ownerRole,
    reviewRole: unit.reviewRole,
    authorityClass: unit.authorityClass,
    actionScope: unit.actionScope,
    state: 'approved',
    grantId: 'agrant_000000000000000000000000',
    approvedBy: 'counsel',
    dedupeKey: unit.dedupeKey,
    supersedes: unit.id,
  }, () => new Date('2026-10-01T10:00:00.000Z'));
  await assert.rejects(
    () => store.supersedeRecord(unit.id, noGrant),
    /unit approval needs a live grant record/,
  );
});

test('a grant successor cannot lower spent or change its identity', async () => {
  const { store } = await tempStore();
  const value = buildAuthorityGrant({
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 100,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
  }, fixedNow);
  await store.writeRecord(value);

  const spent = buildAuthorityGrant({
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 100,
    spent: 60,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
    dedupeKey: value.dedupeKey,
    supersedes: value.id,
    eventAt: '2026-10-01T10:00:00.000Z',
  }, () => new Date('2026-10-01T10:00:00.000Z'));
  await store.supersedeRecord(value.id, spent);

  const rewind = buildAuthorityGrant({
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 100,
    spent: 0,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
    dedupeKey: value.dedupeKey,
    supersedes: spent.id,
    eventAt: '2026-10-02T10:00:00.000Z',
  }, () => new Date('2026-10-02T10:00:00.000Z'));
  await assert.rejects(() => store.supersedeRecord(spent.id, rewind), /cannot lower spent/);

  const scopeChange = buildAuthorityGrant({
    role: 'money',
    scope: 'email:send',
    actionClass: 'reversible',
    budget: 100,
    spent: 60,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
    dedupeKey: value.dedupeKey,
    supersedes: spent.id,
    eventAt: '2026-10-03T10:00:00.000Z',
  }, () => new Date('2026-10-03T10:00:00.000Z'));
  await assert.rejects(() => store.supersedeRecord(spent.id, scopeChange), /cannot change scope/);
});

test('two stores via symlinked aliases of one dataDir serialize', async () => {
  const { dataDir } = await tempStore();
  const alias = `${dataDir}-alias`;
  await fs.symlink(dataDir, alias);
  const a = createCompanyStore({ dataDir });
  const b = createCompanyStore({ dataDir: alias });
  const rule = buildBusinessRule(ruleInput(), fixedNow);
  const twin = {
    ...rule,
    id: companyRecordId('BusinessRule', rule.dedupeKey, 'twin'),
  };
  const results = await Promise.allSettled([a.writeRecord(rule), b.writeRecord(twin)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal((await a.liveRecords('BusinessRule')).length, 1);
});
