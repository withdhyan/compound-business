import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { UNIT_TRANSITIONS, buildAuthorityGrant, buildBusinessUnit } from './records.mjs';
import { createCompanyStore } from './store.mjs';
import { assertUnitTransition, transitionUnit, unitIsTerminal } from './unit.mjs';

const T0 = '2026-09-22T10:00:00.000Z';

function at(hours) {
  return new Date(Date.parse(T0) + hours * 3_600_000).toISOString();
}

function unitInput(overrides = {}) {
  return {
    title: 'Wedge demand test',
    stage: 'validation',
    goal: 'Prove existing spend on the wedge',
    evidence: ['bdec_1'],
    verification: 'Pre-registered call thresholds met',
    killCriterion: 'A1 <= 2 kills the wedge',
    ownerRole: 'gtm',
    reviewRole: 'analyst',
    authorityClass: 'draft',
    ...overrides,
  };
}

async function tempStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'company-unit-'));
  return createCompanyStore({ dataDir, now: () => new Date(T0) });
}

async function advance(store, unit, state, context, when) {
  const { successor, transition } = await transitionUnit(unit, state, { ...context, at: when }, () => new Date(when));
  const { successor: written } = await store.supersedeRecord(unit.id, successor);
  return { unit: written, transition };
}

test('a unit runs planned → approved → running → review → shipped through the store', async () => {
  const store = await tempStore();
  const unit = buildBusinessUnit(unitInput(), () => new Date(T0));
  await store.writeRecord(unit);

  const approved = await advance(store, unit, 'approved', { actor: 'chief' }, at(1));
  const running = await advance(store, approved.unit, 'running', { actor: 'gtm' }, at(2));
  const review = await advance(store, running.unit, 'review', { actor: 'gtm' }, at(3));
  const shipped = await advance(store, review.unit, 'shipped', {
    actor: 'gtm',
    reviewer: 'analyst',
    reviewReceiptId: 'audit_review_1',
  }, at(4));

  assert.equal(shipped.transition.from, 'review');
  assert.equal(shipped.unit.state, 'shipped');
  assert.equal(unitIsTerminal(shipped.unit), true);
  assert.equal(shipped.unit.dedupeKey, unit.dedupeKey);
  assert.equal(shipped.unit.supersedes, review.unit.id);
  assert.equal(shipped.unit.reviewer, 'analyst');
  assert.equal(shipped.unit.reviewReceiptId, 'audit_review_1');

  assert.equal((await store.listRecords('BusinessUnit')).length, 5);
  assert.equal((await store.liveRecords('BusinessUnit')).length, 1);
});

test('shipping needs a review receipt from a role other than the executor', async () => {
  const store = await tempStore();
  const unit = buildBusinessUnit(unitInput(), () => new Date(T0));
  await store.writeRecord(unit);
  const running = await advance(store, unit, 'approved', { actor: 'chief' }, at(1));
  const review = await advance(store, running.unit, 'running', { actor: 'gtm' }, at(2));
  const inReview = await advance(store, review.unit, 'review', { actor: 'gtm' }, at(3));

  await assert.rejects(
    transitionUnit(inReview.unit, 'shipped', {
      actor: 'gtm',
      at: at(4),
    }, () => new Date(at(4))),
    /reviewReceiptId/,
  );
  await assert.rejects(
    transitionUnit(inReview.unit, 'shipped', {
      actor: 'gtm',
      reviewer: 'gtm',
      reviewReceiptId: 'audit_review_1',
      at: at(4),
    }, () => new Date(at(4))),
    /cannot review its own unit/,
  );
});

test('an irreversible unit needs a live grant and a founder receipt to approve, and a receipt to ship', async () => {
  const store = await tempStore();
  const unit = buildBusinessUnit(unitInput({
    title: 'Sign the data-processing agreement',
    ownerRole: 'counsel',
    reviewRole: 'chief',
    authorityClass: 'irreversible',
    actionScope: 'contract:sign',
  }), () => new Date(T0));
  await store.writeRecord(unit);
  const grant = buildAuthorityGrant({
    role: 'counsel',
    scope: 'contract:sign',
    actionClass: 'irreversible',
    budget: null,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
  }, () => new Date(T0));
  await store.writeRecord(grant);

  await assert.rejects(
    transitionUnit(unit, 'approved', { actor: 'counsel', at: at(1), store }, () => new Date(at(1))),
    /no live grant/,
  );
  await assert.rejects(
    transitionUnit(unit, 'approved', {
      actor: 'counsel',
      store,
      grantIds: [grant.id],
      at: at(1),
    }, () => new Date(at(1))),
    /founder receipt/,
  );

  const approved = await advance(store, unit, 'approved', {
    actor: 'counsel',
    store,
    grantIds: [grant.id],
    founderReceiptId: 'card_1',
  }, at(2));
  assert.equal(approved.unit.grantId, grant.id);
  assert.equal(approved.unit.approvedBy, 'counsel');
  const running = await advance(store, approved.unit, 'running', { actor: 'counsel' }, at(3));
  const review = await advance(store, running.unit, 'review', { actor: 'counsel' }, at(4));

  await assert.rejects(
    transitionUnit(review.unit, 'shipped', {
      actor: 'counsel',
      reviewer: 'chief',
      reviewReceiptId: 'audit_review_2',
      at: at(5),
    }, () => new Date(at(5))),
    /founderReceiptId/,
  );

  const shipped = await advance(store, review.unit, 'shipped', {
    actor: 'counsel',
    reviewer: 'chief',
    reviewReceiptId: 'audit_review_2',
    founderReceiptId: 'card_2',
  }, at(6));
  assert.equal(shipped.unit.state, 'shipped');
  assert.equal(shipped.unit.founderReceiptId, 'card_2');
});

test('a reversible unit needs a live stored grant to be approved', async () => {
  const store = await tempStore();
  const unit = buildBusinessUnit(unitInput({
    title: 'Send the outreach wave',
    authorityClass: 'reversible',
    actionScope: 'email:send',
  }), () => new Date(T0));
  await store.writeRecord(unit);

  await assert.rejects(
    transitionUnit(unit, 'approved', { actor: 'gtm', at: at(1), store }, () => new Date(at(1))),
    /no live grant/,
  );

  const grant = buildAuthorityGrant({
    role: 'gtm',
    scope: 'email:send',
    actionClass: 'reversible',
    budget: 0,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
  }, () => new Date(T0));
  await store.writeRecord(grant);
  const approved = await advance(store, unit, 'approved', {
    actor: 'gtm',
    store,
    grantIds: [grant.id],
  }, at(2));
  assert.equal(approved.unit.state, 'approved');
  assert.equal(approved.unit.grantId, grant.id);
  assert.equal(approved.unit.approvedBy, 'gtm');

  const running = await advance(store, approved.unit, 'running', { actor: 'gtm' }, at(3));
  const review = await advance(store, running.unit, 'review', { actor: 'gtm' }, at(4));
  const shipped = await advance(store, review.unit, 'shipped', {
    actor: 'gtm',
    reviewer: 'analyst',
    reviewReceiptId: 'audit_review_1',
  }, at(5));
  assert.equal(shipped.unit.grantId, grant.id);
  assert.equal(shipped.unit.approvedBy, 'gtm');
});

test('holds and kills must say why, and killed is terminal', async () => {
  const store = await tempStore();
  const unit = buildBusinessUnit(unitInput(), () => new Date(T0));
  await store.writeRecord(unit);

  await assert.rejects(
    transitionUnit(unit, 'killed', { actor: 'chief', at: at(1) }, () => new Date(at(1))),
    /reason/,
  );

  const approved = await advance(store, unit, 'approved', { actor: 'chief' }, at(2));
  const running = await advance(store, approved.unit, 'running', { actor: 'gtm' }, at(3));
  const review = await advance(store, running.unit, 'review', { actor: 'gtm' }, at(4));
  const held = await advance(store, review.unit, 'held', {
    actor: 'analyst',
    reason: 'Evidence underpowered (n=5)',
  }, at(5));
  assert.equal(held.unit.state, 'held');
  assert.equal(held.unit.reason, 'Evidence underpowered (n=5)');

  const back = await advance(store, held.unit, 'review', { actor: 'analyst' }, at(6));
  const killed = await advance(store, back.unit, 'killed', {
    actor: 'chief',
    reason: 'Wedge disproved by pre-registered thresholds',
  }, at(7));
  assert.equal(unitIsTerminal(killed.unit), true);
  assert.deepEqual([...UNIT_TRANSITIONS.killed], []);
  assert.throws(() => assertUnitTransition(killed.unit, 'review'), /transition refused/);
});

test('illegal jumps are refused by the state machine', () => {
  const unit = buildBusinessUnit(unitInput(), () => new Date(T0));
  assert.throws(() => assertUnitTransition(unit, 'shipped'), /planned → shipped/);
  assert.throws(() => assertUnitTransition(unit, 'running'), /planned → running/);
  assert.deepEqual([...UNIT_TRANSITIONS.planned], ['approved', 'killed']);
});
