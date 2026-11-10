import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTHORITY_CLASSES,
  BUSINESS_STAGES,
  COMPANY_RECORD_KINDS,
  assertCompanyRecordShape,
  assertIdeaTransition,
  buildAuditEntry,
  buildAuthorityGrant,
  buildBusinessDecision,
  buildBusinessIdea,
  buildBusinessMetric,
  buildBusinessRule,
  buildBusinessStage,
  buildBusinessUnit,
  businessKey,
  companyRecordId,
  kindForRecordId,
} from './records.mjs';

const now = () => new Date('2026-09-22T10:00:00.000Z');

function unitInput(overrides = {}) {
  return {
    title: 'Seed capital pipeline',
    stage: 'validation',
    goal: 'Close the first committed check',
    evidence: ['bdec_evidence_1'],
    verification: 'Signed commitment or written wire confirmation',
    killCriterion: 'No committed check by 2026-11-01',
    ownerRole: 'capital',
    reviewRole: 'chief',
    authorityClass: 'irreversible',
    actionScope: 'capital:close',
    ...overrides,
  };
}

test('the company record world is closed and prefixed', () => {
  assert.deepEqual(
    [...COMPANY_RECORD_KINDS].sort(),
    [
      'AuditEntry',
      'AuthorityGrant',
      'BusinessDecision',
      'BusinessIdea',
      'BusinessMeasure',
      'BusinessMetric',
      'BusinessReceipt',
      'BusinessRule',
      'BusinessStage',
      'BusinessUnit',
    ],
  );
  assert.equal(BUSINESS_STAGES.length, 7);
  assert.deepEqual(AUTHORITY_CLASSES, ['advise', 'draft', 'reversible', 'irreversible']);
  const id = companyRecordId('BusinessUnit', 'unit:x');
  assert.equal(kindForRecordId(id), 'BusinessUnit');
  assert.throws(() => kindForRecordId('nope_123'), /unrecognized company record id/);
});

test('a unit needs a plan, a kill criterion, and a different reviewer', () => {
  const unit = buildBusinessUnit(unitInput(), now);
  assert.equal(unit.kind, 'BusinessUnit');
  assert.equal(unit.state, 'planned');
  assert.equal(unit.dedupeKey, 'unit:seed-capital-pipeline');
  assert.equal(unit.reviewRole, 'chief');
  assert.equal(unit.validTo, null);

  assert.throws(() => buildBusinessUnit(unitInput({ evidence: [] }), now), /at least one id/);
  assert.throws(
    () => buildBusinessUnit(unitInput({ reviewRole: 'capital' }), now),
    /review role must differ/,
  );
  assert.throws(
    () => buildBusinessUnit(unitInput({ authorityClass: 'auto' }), now),
    /invalid authority class/,
  );
  assert.throws(
    () => buildBusinessUnit(unitInput({ stage: 'vibes' }), now),
    /invalid business stage/,
  );
});

test('a decided lever must be decided by the founder', () => {
  const open = buildBusinessDecision({
    type: 'lever',
    scope: 'capital',
    statement: 'Foundation-funded vs classical raise',
    rationale: 'Changes the company constitution',
  }, now);
  assert.equal(open.status, 'open');
  assert.throws(
    () => buildBusinessDecision({
      type: 'lever',
      scope: 'capital',
      statement: 'Foundation-funded vs classical raise',
      rationale: 'Changes the company constitution',
      status: 'decided',
      decidedBy: 'analyst',
    }, now),
    /decided by the founder/,
  );
});

test('metrics carry a definition, an as-of date, and an evidence class', () => {
  const measured = buildBusinessMetric({
    name: 'cash_on_hand_usd',
    value: 12000,
    asOf: '2026-09-22',
    definition: 'Bank balance across operating accounts, end of day',
    evidenceClass: 'measured',
  }, now);
  assert.equal(measured.value, 12000);

  const unreadable = buildBusinessMetric({
    name: 'cash_on_hand_usd',
    value: null,
    asOf: '2026-09-23',
    definition: 'Bank balance across operating accounts, end of day',
    evidenceClass: 'measured',
  }, now);
  assert.equal(unreadable.value, null);

  assert.throws(
    () => buildBusinessMetric({
      name: 'cash_on_hand_usd',
      value: Number.NaN,
      asOf: '2026-09-22',
      definition: 'x',
      evidenceClass: 'measured',
    }, now),
    /finite number or null/,
  );
  assert.throws(
    () => buildBusinessMetric({
      name: 'cash_on_hand_usd',
      value: 1,
      asOf: '2026-09-22',
      definition: 'x',
      evidenceClass: 'guessed',
    }, now),
    /invalid evidence class/,
  );
});

test('rules carry a receipt, and a pruned rule says why', () => {
  const rule = buildBusinessRule({
    role: 'content',
    statement: 'Never publish on Fridays',
    rationale: 'Replies spike unseen over weekends',
    receiptId: 'audit_1',
  }, now);
  assert.equal(rule.status, 'live');
  assert.throws(
    () => buildBusinessRule({
      role: 'content',
      statement: 'Never publish on Fridays',
      rationale: 'x',
      receiptId: 'audit_1',
      status: 'pruned',
    }, now),
    /must say why/,
  );
});

test('authority grants are founder-issued, time-limited, and never advisory', () => {
  const grant = buildAuthorityGrant({
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 500,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
  }, now);
  assert.equal(grant.spent, 0);
  assert.equal(grant.revokedAt, null);

  assert.throws(
    () => buildAuthorityGrant({
      role: 'money',
      scope: 'ap:pay',
      actionClass: 'draft',
      expiresAt: '2026-10-22T00:00:00.000Z',
      grantedBy: 'founder',
    }, now),
    /only meaningful for reversible or irreversible/,
  );
  assert.throws(
    () => buildAuthorityGrant({
      role: 'money',
      scope: 'ap:pay',
      actionClass: 'reversible',
      expiresAt: '2026-10-22T00:00:00.000Z',
      grantedBy: 'chief',
    }, now),
    /only the founder grants authority/,
  );
  assert.throws(
    () => buildAuthorityGrant({
      role: 'money',
      scope: 'ap:pay',
      actionClass: 'reversible',
      grantedBy: 'founder',
    }, now),
    /expiresAt/,
  );
});

test('ideas carry the x100: variants, a verdict, and chosen picks', () => {
  const idea = buildBusinessIdea({ statement: 'A CLI that mines my notes for ideas' }, now);
  assert.equal(idea.status, 'seed');
  assert.deepEqual(idea.variants, []);
  assert.throws(() => buildBusinessIdea({ statement: '   ' }, now), /statement/);

  const variant = (title) => ({
    title,
    angle: 'wedge',
    oneLiner: 'one line',
    firstBuild: 'a script',
    why10x: 'compounds',
  });
  const amplified = buildBusinessIdea({
    statement: 'A CLI that mines my notes for ideas',
    status: 'amplified',
    variants: [variant('Miner'), variant('Amplifier')],
  }, now);
  assert.equal(amplified.variants.length, 2);

  assert.throws(
    () => buildBusinessIdea({ statement: 'mine my notes', status: 'amplified' }, now),
    /needs variants/,
  );
  assert.throws(
    () => buildBusinessIdea({
      statement: 'mine my notes',
      status: 'amplified',
      variants: [variant('Miner')],
      chosenVariants: ['Nope'],
    }, now),
    /not in the amplification/,
  );
  assert.throws(
    () => buildBusinessIdea({
      statement: 'mine my notes',
      status: 'decided',
      variants: [variant('Miner')],
    }, now),
    /needs at least one chosen/,
  );
  assert.throws(
    () => buildBusinessIdea({
      statement: 'mine my notes',
      variants: [variant('Miner')],
      status: 'amplified',
      evaluation: { verdict: 'maybe' },
    }, now),
    /invalid idea verdict/,
  );
  assert.throws(
    () => buildBusinessIdea({
      statement: 'mine my notes',
      variants: [variant('Miner')],
      status: 'amplified',
      evaluation: { verdict: 'amplify', scores: { pull: 11 } },
    }, now),
    /0–10/,
  );

  const decided = buildBusinessIdea({
    statement: 'A CLI that mines my notes for ideas',
    status: 'decided',
    variants: [variant('Miner')],
    chosenVariants: ['Miner'],
    evaluation: { verdict: 'amplify', scores: { pull: 7, fit: 9 } },
  }, now);
  assert.equal(decided.evaluation.verdict, 'amplify');

  assert.equal(assertIdeaTransition('seed', 'amplified'), 'amplified');
  assert.throws(() => assertIdeaTransition('seed', 'decided'), /idea transition refused/);
});

test('stage records need evidence, and audit outcomes are closed', () => {
  assert.throws(() => buildBusinessStage({ stage: 'idea', evidenceIds: [] }, now), /at least one id/);
  const stage = buildBusinessStage({ stage: 'validation', evidenceIds: ['bmet_1'] }, now);
  assert.equal(stage.dedupeKey, 'stage:company');

  assert.throws(
    () => buildAuditEntry({ actor: 'money', action: 'pay', actionClass: 'reversible', outcome: 'maybe' }, now),
    /invalid audit outcome/,
  );
  assert.notEqual(
    buildAuditEntry({ actor: 'money', action: 'pay', actionClass: 'reversible', outcome: 'allowed' }, now).id,
    buildAuditEntry({ actor: 'money', action: 'pay', actionClass: 'reversible', outcome: 'allowed' }, now).id,
  );
});

test('business keys slug or refuse', () => {
  assert.equal(businessKey('unit', 'Seed Capital Pipeline!'), 'unit:seed-capital-pipeline');
  assert.throws(() => businessKey('unit', '!!!'), /would be empty/);
});

test('record ids are kind-prefixed hashes, never paths', () => {
  assert.throws(() => kindForRecordId('brule_not-a-hash'), /unrecognized company record id/);
  assert.throws(() => kindForRecordId('bunit_../../escape'), /unrecognized company record id/);
  assert.throws(() => kindForRecordId('bunit_0123456789abcdef0123456Z'), /unrecognized company record id/);
  assert.throws(() => kindForRecordId('zzzz_0123456789abcdef01234567'), /unrecognized company record id/);
});

test('reversible units need a scope, and the state enum stays closed', () => {
  assert.throws(
    () => buildBusinessUnit(unitInput({ authorityClass: 'reversible', actionScope: undefined }), now),
    /needs an actionScope/,
  );
  const scoped = buildBusinessUnit(unitInput({ authorityClass: 'reversible', actionScope: 'email:send' }), now);
  assert.equal(scoped.actionScope, 'email:send');
  assert.throws(() => buildBusinessUnit(unitInput({ state: 'launched' }), now), /invalid unit state/);
  // The builder is a constructor; the store is the gate that refuses a first
  // record outside planned (see store.test.mjs).
  assert.equal(buildBusinessUnit(unitInput({ state: 'shipped', reviewer: 'chief', reviewReceiptId: 'r' }), now).state, 'shipped');
});

test('the store-side shape check refuses hand-built records that skip builder law', () => {
  const unit = buildBusinessUnit(unitInput(), now);
  assert.throws(
    () => assertCompanyRecordShape({ ...unit, killCriterion: undefined }),
    /killCriterion/,
  );
  assert.throws(
    () => assertCompanyRecordShape({ ...unit, reviewRole: unit.ownerRole }),
    /review role must differ/,
  );
  assert.throws(
    () => assertCompanyRecordShape({ ...unit, reviewer: 'chief' }),
    /a planned unit cannot carry reviewer/,
  );
  assert.throws(
    () => assertCompanyRecordShape({ ...unit, supersededById: 'brule_000000000000000000000000' }),
    /same kind/,
  );
  assert.throws(
    () => assertCompanyRecordShape({ ...unit, provenance: { surface: 'x', lane: 'nope' } }),
    /invalid provenance.lane/,
  );
  const metric = buildBusinessMetric({
    name: 'cash_on_hand_usd',
    value: 1,
    asOf: '2026-09-22',
    definition: 'x',
    evidenceClass: 'measured',
  }, now);
  assert.throws(
    () => assertCompanyRecordShape({ ...metric, definition: undefined }),
    /definition/,
  );
  const grant = buildAuthorityGrant({
    role: 'money',
    scope: 'ap:pay',
    actionClass: 'reversible',
    budget: 100,
    expiresAt: '2026-10-22T00:00:00.000Z',
    grantedBy: 'founder',
  }, now);
  assert.throws(
    () => assertCompanyRecordShape({ ...grant, grantedBy: 'chief' }),
    /only the founder grants authority/,
  );
  assert.throws(
    () => assertCompanyRecordShape({ ...grant, actionClass: 'draft' }),
    /only meaningful for reversible or irreversible/,
  );
  assert.throws(
    () => assertCompanyRecordShape({ ...unit, id: 'bdec_000000000000000000000000' }),
    /does not belong to kind/,
  );
});

// ---- labels and founder principals ----------------------------------------

import { buildPolicy } from './policy.mjs';
import { isGrantLive } from './records.mjs';

const multiPolicy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'founders' },
});

function ruleBody(overrides = {}) {
  return { role: 'content', statement: 'No Friday posts', rationale: 'r', receiptId: 'audit_1', ...overrides };
}

test('records carry an optional label that is validated and persisted', () => {
  const rule = buildBusinessRule(ruleBody({ label: 'Team' }), now);
  assert.equal(rule.label, 'team');
  assert.equal(assertCompanyRecordShape(rule).label, 'team');
  assert.equal('label' in buildBusinessRule(ruleBody(), now), false);
  assert.throws(() => buildBusinessRule(ruleBody({ label: 'secret' }), now), /invalid label/);
  assert.throws(
    () => assertCompanyRecordShape({ ...buildBusinessRule(ruleBody(), now), label: 'secret' }),
    /invalid label/,
  );
});

test('a second founder can grant authority and decide levers under a policy', () => {
  const grantInput = {
    role: 'money', scope: 'ap:pay', actionClass: 'reversible', budget: 10,
    expiresAt: '2026-12-01T00:00:00.000Z', grantedBy: 'cofounder',
  };
  assert.throws(() => buildAuthorityGrant(grantInput, now), /only the founder grants authority/);
  const grant = buildAuthorityGrant(grantInput, now, multiPolicy);
  assert.equal(grant.grantedBy, 'cofounder');
  assert.throws(() => assertCompanyRecordShape(grant), /only the founder grants authority/);
  assertCompanyRecordShape(grant, multiPolicy);
  assert.equal(isGrantLive(grant, '2026-09-23T00:00:00.000Z'), false);
  assert.equal(isGrantLive(grant, '2026-09-23T00:00:00.000Z', multiPolicy), true);
  assert.throws(
    () => buildAuthorityGrant({ ...grantInput, grantedBy: 'guest-artist' }, now, multiPolicy),
    /only the founder grants authority/,
  );

  const lever = {
    type: 'lever', scope: 'capital', statement: 'Raise from Acme', rationale: 'r',
    status: 'decided', decidedBy: 'cofounder',
  };
  assert.throws(() => buildBusinessDecision(lever, now), /decided by the founder/);
  assertCompanyRecordShape(buildBusinessDecision(lever, now, multiPolicy), multiPolicy);
});

test('stage names come from the policy ladder when one is configured', () => {
  const policy = buildPolicy({
    owner: 'f', founders: ['f'], principals: { f: 'personal' },
    stages: [{ name: 'measures', bindingConstraint: 'x', exitCriteria: ['c'] }],
  });
  assert.throws(() => buildBusinessStage({ stage: 'measures', evidenceIds: ['bmet_1'] }, now), /invalid business stage/);
  assert.equal(buildBusinessStage({ stage: 'measures', evidenceIds: ['bmet_1'] }, now, policy).stage, 'measures');
  assert.throws(() => buildBusinessStage({ stage: 'pmf', evidenceIds: ['bmet_1'] }, now, policy), /invalid business stage/);
});
