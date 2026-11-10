import { createHash, randomUUID } from 'node:crypto';

import {
  biTemporal,
  isPlainObject,
  normalizeProvenance,
  optionalString,
  requiredString,
} from './kernel.mjs';
import { DEFAULT_POLICY, isFounderPrincipal, normalizeLabel } from './policy.mjs';

// The company runtime's closed record world. These kinds never enter the
// personal substrate: business state is a separate surface with its own store
// (see store.mjs) and its own law (AGENTS.md beside this module).
export const COMPANY_RECORD_KINDS = Object.freeze([
  'BusinessUnit',
  'BusinessDecision',
  'BusinessMetric',
  'BusinessRule',
  'BusinessStage',
  'BusinessIdea',
  'BusinessMeasure',
  'BusinessReceipt',
  'AuthorityGrant',
  'AuditEntry',
]);

export const COMPANY_SCHEMA_VERSION = 1;

const KIND_PREFIX = Object.freeze({
  BusinessUnit: 'bunit',
  BusinessDecision: 'bdec',
  BusinessMetric: 'bmet',
  BusinessRule: 'brule',
  BusinessStage: 'bstage',
  BusinessIdea: 'bidea',
  BusinessMeasure: 'bmeas',
  BusinessReceipt: 'brcpt',
  AuthorityGrant: 'agrant',
  AuditEntry: 'audit',
});

// 0→100 stages. The binding constraint names what must move to leave the
// stage; exitCriteria are the evidence areas a forward move must cover.
export const BUSINESS_STAGES = Object.freeze([
  'idea',
  'validation',
  'first_revenue',
  'pmf',
  'growth',
  'default_alive',
  'scale',
]);

export const UNIT_STATES = Object.freeze([
  'planned',
  'approved',
  'running',
  'review',
  'shipped',
  'held',
  'killed',
]);

// Transitions are law: a new state or edge is an ADR-level change, never a
// local patch. `held` is the fail-closed rest state; `killed` is terminal.
export const UNIT_TRANSITIONS = Object.freeze({
  planned: Object.freeze(['approved', 'killed']),
  approved: Object.freeze(['running', 'killed']),
  running: Object.freeze(['review', 'killed']),
  review: Object.freeze(['shipped', 'held', 'killed']),
  shipped: Object.freeze([]),
  held: Object.freeze(['review', 'killed']),
  killed: Object.freeze([]),
});

export const AUTHORITY_CLASSES = Object.freeze([
  'advise',
  'draft',
  'reversible',
  'irreversible',
]);

export const EVIDENCE_CLASSES = Object.freeze([
  'measured',
  'estimated',
  'assumed',
]);

export const DECISION_TYPES = Object.freeze([
  'lever',
  'judgment',
  'mechanical',
]);

export const DECISION_SCOPES = Object.freeze([
  'strategy',
  'positioning',
  'pricing',
  'capital',
  'product',
  'money',
  'gtm',
  'legal',
  'people',
  'ops',
  'data',
]);

export const RULE_STATUSES = Object.freeze(['live', 'pruned']);

// An idea is a seed the founder drops in; amplification develops it into
// variants; a decision picks which variants become units. The x100 lives in
// the variants list, the memory lives in the receipts around it.
export const IDEA_STATUSES = Object.freeze([
  'seed',
  'amplified',
  'decided',
  'building',
  'shipped',
  'dropped',
]);

export const IDEA_TRANSITIONS = Object.freeze({
  seed: Object.freeze(['amplified', 'dropped']),
  amplified: Object.freeze(['decided', 'dropped']),
  decided: Object.freeze(['building', 'dropped']),
  building: Object.freeze(['shipped', 'dropped']),
  shipped: Object.freeze([]),
  dropped: Object.freeze([]),
});

export const IDEA_VERDICTS = Object.freeze(['amplify', 'park', 'kill']);

export const IDEA_SCORE_KEYS = Object.freeze([
  'pull',
  'fit',
  'novelty',
  'feasibility',
  'alignment',
]);

export const DEFAULT_PROVENANCE = Object.freeze({
  surface: 'company-runtime',
  lane: 'deliberate',
});

export function companyRecordId(kind, dedupeKey, disambiguator = '') {
  assertCompanyKind(kind);
  assertRequired(dedupeKey, 'dedupeKey');
  const hash = createHash('sha256')
    .update(`${kind}\n${dedupeKey}\n${disambiguator}`)
    .digest('hex')
    .slice(0, 24);
  return `${KIND_PREFIX[kind]}_${hash}`;
}

export function kindForRecordId(id) {
  const value = requiredString(id, 'id');
  const match = /^([a-z]+)_([0-9a-f]{24})$/.exec(value);
  const kind = match
    ? Object.entries(KIND_PREFIX).find(([, prefix]) => prefix === match[1])?.[0]
    : null;
  if (!kind) throw new Error(`unrecognized company record id: ${value}`);
  return kind;
}

export function businessKey(prefix, value) {
  const slug = requiredString(value, 'value')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  if (!slug) throw new Error(`${prefix} key would be empty`);
  return `${prefix}:${slug}`;
}

export function assertCompanyKind(kind) {
  if (!COMPANY_RECORD_KINDS.includes(kind)) {
    throw new Error(`unknown company record kind: ${kind}`);
  }
}

export function normalizeBusinessStage(value, policy = DEFAULT_POLICY) {
  const stage = requiredString(value, 'stage').toLowerCase();
  if (!(policy.stageNames ?? BUSINESS_STAGES).includes(stage)) {
    throw new Error(`invalid business stage: ${stage}`);
  }
  return stage;
}

export function normalizeUnitState(value) {
  const state = requiredString(value, 'state').toLowerCase();
  if (!UNIT_STATES.includes(state)) {
    throw new Error(`invalid unit state: ${state}`);
  }
  return state;
}

export function normalizeAuthorityClass(value) {
  const actionClass = requiredString(value, 'authorityClass').toLowerCase();
  if (!AUTHORITY_CLASSES.includes(actionClass)) {
    throw new Error(`invalid authority class: ${actionClass}`);
  }
  return actionClass;
}

export function normalizeIdeaStatus(value) {
  const status = requiredString(value, 'status').toLowerCase();
  if (!IDEA_STATUSES.includes(status)) {
    throw new Error(`invalid idea status: ${status}`);
  }
  return status;
}

export function assertIdeaTransition(from, to) {
  const current = normalizeIdeaStatus(from);
  const next = normalizeIdeaStatus(to);
  const allowed = IDEA_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`idea transition refused: ${current} → ${next}`);
  }
  return next;
}

export function normalizeIdeaEvaluation(value) {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) {
    throw new Error('idea evaluation must be an object');
  }
  const verdict = requiredString(value.verdict, 'evaluation.verdict').toLowerCase();
  if (!IDEA_VERDICTS.includes(verdict)) {
    throw new Error(`invalid idea verdict: ${verdict}`);
  }
  const scores = value.scores ?? {};
  if (!isPlainObject(scores)) {
    throw new Error('evaluation.scores must be an object');
  }
  const normalizedScores = {};
  for (const key of IDEA_SCORE_KEYS) {
    const score = scores[key];
    if (score === undefined) continue;
    if (!(Number.isFinite(score) && score >= 0 && score <= 10)) {
      throw new Error(`evaluation score ${key} must be 0–10`);
    }
    normalizedScores[key] = score;
  }
  return {
    verdict,
    scores: normalizedScores,
    ...(optionalString(value.note) ? { note: optionalString(value.note) } : {}),
  };
}

export function normalizeEvidenceClass(value) {
  const evidenceClass = requiredString(value, 'evidenceClass').toLowerCase();
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    throw new Error(`invalid evidence class: ${evidenceClass}`);
  }
  return evidenceClass;
}

// Grant liveness is shared by the ladder and the store: a live grant is a
// founder-issued, unrevoked, unexpired, un-superseded record whose validFrom
// has arrived. Non-finite spend or budget fails closed.
export function isGrantLive(grant, at, policy = DEFAULT_POLICY) {
  if (!isPlainObject(grant) || grant.kind !== 'AuthorityGrant') return false;
  if (typeof grant.id !== 'string' || grant.id.trim() === '') return false;
  if (!isFounderPrincipal(grant.grantedBy, policy)) return false;
  if (grant.revokedAt) return false;
  if (grant.validTo || grant.supersededById) return false;
  if (grant.spent !== undefined && !(Number.isFinite(grant.spent) && grant.spent >= 0)) return false;
  if (grant.budget !== null && grant.budget !== undefined && !(Number.isFinite(grant.budget) && grant.budget >= 0)) return false;
  const nowMs = Date.parse(requiredString(at, 'at'));
  const validMs = Date.parse(requiredString(grant.validFrom, 'grant.validFrom'));
  const expiresMs = Date.parse(requiredString(grant.expiresAt, 'grant.expiresAt'));
  if (Number.isNaN(nowMs) || Number.isNaN(validMs) || Number.isNaN(expiresMs)) return false;
  return validMs <= nowMs && expiresMs > nowMs;
}

export function remainingBudget(grant) {
  if (!isPlainObject(grant) || grant.budget === null || grant.budget === undefined) {
    return null;
  }
  const remaining = grant.budget - (grant.spent ?? 0);
  return Number.isFinite(remaining) ? Math.max(0, remaining) : null;
}

export function buildBusinessUnit(input, now, policy = DEFAULT_POLICY) {
  const value = requireInput(input, 'BusinessUnit');
  const stage = normalizeBusinessStage(value.stage, policy);
  const authorityClass = normalizeAuthorityClass(value.authorityClass);
  const ownerRole = requiredString(value.ownerRole, 'ownerRole');
  const reviewRole = requiredString(value.reviewRole, 'reviewRole');
  if (ownerRole === reviewRole) {
    throw new Error('review role must differ from owner role');
  }
  const evidence = requireEvidenceIds(value.evidence, 'unit evidence');
  const title = requiredString(value.title, 'title');
  const dedupeKey = value.dedupeKey ?? businessKey('unit', title);
  const state = normalizeUnitState(value.state ?? 'planned');
  const actionScope = optionalString(value.actionScope);
  if (
    (authorityClass === 'reversible' || authorityClass === 'irreversible') &&
    !actionScope
  ) {
    throw new Error('a reversible or irreversible unit needs an actionScope');
  }
  const body = {
    title,
    stage,
    goal: requiredString(value.goal, 'goal'),
    evidence,
    verification: requiredString(value.verification, 'verification'),
    killCriterion: requiredString(value.killCriterion, 'killCriterion'),
    ownerRole,
    reviewRole,
    authorityClass,
    ...(actionScope ? { actionScope } : {}),
    state,
    ...(optionalString(value.reviewer) ? { reviewer: optionalString(value.reviewer) } : {}),
    ...(optionalString(value.reviewReceiptId) ? { reviewReceiptId: optionalString(value.reviewReceiptId) } : {}),
    ...(optionalString(value.founderReceiptId) ? { founderReceiptId: optionalString(value.founderReceiptId) } : {}),
    ...(optionalString(value.grantId) ? { grantId: optionalString(value.grantId) } : {}),
    ...(optionalString(value.approvedBy) ? { approvedBy: optionalString(value.approvedBy) } : {}),
    ...(optionalString(value.notes) ? { notes: optionalString(value.notes) } : {}),
    ...(optionalString(value.reason) ? { reason: optionalString(value.reason) } : {}),
  };
  return envelope({ kind: 'BusinessUnit', dedupeKey, value, now, body });
}

export function buildBusinessDecision(input, now, policy = DEFAULT_POLICY) {
  const value = requireInput(input, 'BusinessDecision');
  const type = requiredString(value.type, 'type').toLowerCase();
  if (!DECISION_TYPES.includes(type)) {
    throw new Error(`invalid decision type: ${type}`);
  }
  const scope = requiredString(value.scope, 'scope').toLowerCase();
  if (!DECISION_SCOPES.includes(scope)) {
    throw new Error(`invalid decision scope: ${scope}`);
  }
  const status = (optionalString(value.status) ?? 'open').toLowerCase();
  if (!['open', 'decided'].includes(status)) {
    throw new Error(`invalid decision status: ${status}`);
  }
  const statement = requiredString(value.statement, 'statement');
  const decidedBy = optionalString(value.decidedBy);
  if (status === 'decided') {
    if (type === 'lever' && !isFounderPrincipal(decidedBy, policy)) {
      throw new Error('a decided lever must be decided by the founder');
    }
    if (!decidedBy) {
      throw new Error('a decided decision must name decidedBy');
    }
  }
  const body = {
    type,
    scope,
    statement,
    rationale: requiredString(value.rationale, 'rationale'),
    status,
    ...(decidedBy ? { decidedBy } : {}),
    ...(optionalString(value.verdict) ? { verdict: optionalString(value.verdict) } : {}),
  };
  return envelope({
    kind: 'BusinessDecision',
    dedupeKey: value.dedupeKey ?? businessKey('decision', statement),
    value,
    now,
    body,
  });
}

export function buildBusinessMetric(input, now) {
  const value = requireInput(input, 'BusinessMetric');
  const name = requiredString(value.name, 'name');
  const asOf = requiredString(value.asOf, 'asOf');
  const evidenceClass = normalizeEvidenceClass(value.evidenceClass);
  const number = value.value;
  if (number !== null && number !== undefined && !Number.isFinite(number)) {
    throw new Error('metric value must be a finite number or null');
  }
  const body = {
    name,
    value: number ?? null,
    ...(optionalString(value.unit) ? { unit: optionalString(value.unit) } : {}),
    asOf,
    definition: requiredString(value.definition, 'definition'),
    evidenceClass,
  };
  return envelope({
    kind: 'BusinessMetric',
    dedupeKey: value.dedupeKey ?? `metric:${name}:${asOf.slice(0, 10)}`,
    value,
    now,
    body,
  });
}

export function buildBusinessRule(input, now) {
  const value = requireInput(input, 'BusinessRule');
  const statement = requiredString(value.statement, 'statement');
  const status = (optionalString(value.status) ?? 'live').toLowerCase();
  if (!RULE_STATUSES.includes(status)) {
    throw new Error(`invalid rule status: ${status}`);
  }
  const pruneReason = optionalString(value.pruneReason);
  if (status === 'pruned' && !pruneReason) {
    throw new Error('a pruned rule must say why');
  }
  const role = requiredString(value.role, 'role');
  const body = {
    role,
    statement,
    rationale: requiredString(value.rationale, 'rationale'),
    receiptId: requiredString(value.receiptId, 'receiptId'),
    status,
    ...(pruneReason ? { pruneReason } : {}),
  };
  return envelope({
    kind: 'BusinessRule',
    dedupeKey: value.dedupeKey ?? businessKey(`rule-${role}`, statement),
    value,
    now,
    body,
  });
}

export function buildBusinessStage(input, now, policy = DEFAULT_POLICY) {
  const value = requireInput(input, 'BusinessStage');
  const body = {
    stage: normalizeBusinessStage(value.stage, policy),
    evidenceIds: requireEvidenceIds(value.evidenceIds, 'stage evidence'),
  };
  return envelope({
    kind: 'BusinessStage',
    dedupeKey: value.dedupeKey ?? 'stage:company',
    value,
    now,
    body,
  });
}

export function buildBusinessIdea(input, now) {
  const value = requireInput(input, 'BusinessIdea');
  const statement = requiredString(value.statement, 'statement');
  const status = normalizeIdeaStatus(value.status ?? 'seed');
  const variants = normalizeIdeaVariants(value.variants);
  if (variants.length > 0 && status === 'seed') {
    throw new Error('an idea with variants is at least amplified');
  }
  if (variants.length === 0 && status !== 'seed' && status !== 'dropped') {
    throw new Error(`a ${status} idea needs variants`);
  }
  const chosenVariants = requireChosenVariants(value.chosenVariants, variants);
  if (['decided', 'building', 'shipped'].includes(status) && chosenVariants.length === 0) {
    throw new Error(`a ${status} idea needs at least one chosen variant`);
  }
  const body = {
    statement,
    ...(optionalString(value.source) ? { source: optionalString(value.source) } : {}),
    status,
    variants,
    chosenVariants,
    ...(optionalString(value.decisionNote) ? { decisionNote: optionalString(value.decisionNote) } : {}),
    ...(normalizeIdeaEvaluation(value.evaluation)
      ? { evaluation: normalizeIdeaEvaluation(value.evaluation) }
      : {}),
  };
  return envelope({
    kind: 'BusinessIdea',
    dedupeKey: value.dedupeKey ?? businessKey('idea', statement),
    value,
    now,
    body,
  });
}

// A measure is an instrument a partner has (or has not) signed off on, with
// its pre-registration and pass threshold. `reportable` is derived: only a
// signed, preregistered measure may be reported as measured.
export function buildBusinessMeasure(input, now) {
  const value = requireInput(input, 'BusinessMeasure');
  const body = measureBody(value);
  return envelope({
    kind: 'BusinessMeasure',
    dedupeKey: value.dedupeKey ?? businessKey('measure', `${body.instrument} ${body.partner}`),
    value,
    now,
    body,
  });
}

function measureBody(value) {
  if (typeof value.signed !== 'boolean') throw new Error('measure signed must be a boolean');
  const prereg = optionalString(value.prereg) ?? null;
  return {
    instrument: requiredString(value.instrument, 'instrument'),
    partner: requiredString(value.partner, 'partner'),
    signed: value.signed,
    prereg,
    threshold: requiredString(value.threshold, 'threshold'),
    population: requiredString(value.population, 'population'),
    ...(optionalString(value.data) ? { data: optionalString(value.data) } : {}),
    reportable: value.signed && prereg !== null,
  };
}

// The receipt gate. Money is counted only when the recipient has accepted in
// writing, a payment date exists and a signed scope exists. `counted` is
// derived and re-checked on every write, so a record cannot claim it.
export const RECEIPT_GATES = Object.freeze(['recipientAcceptance', 'paymentDate', 'signedScope']);


export function buildBusinessReceipt(input, now) {
  const value = requireInput(input, 'BusinessReceipt');
  const body = receiptBody(value, now);
  return envelope({
    kind: 'BusinessReceipt',
    dedupeKey: value.dedupeKey ?? businessKey('receipt', `${body.counterparty} ${body.what}`),
    value,
    now,
    body,
  });
}

const ITEM_ID = /^mem_[0-9a-f]{16}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

// A gate is met only by evidence of the right shape: acceptance and signed
// scope are memory item ids (the letter, the signed document, stored and
// citable); the payment date is an ISO date that is not in the future.
// Anything else is kept as written and simply does not count.
export function receiptGateFormat(value) {
  return {
    recipientAcceptance: ITEM_ID.test(value.recipientAcceptance ?? ''),
    signedScope: ITEM_ID.test(value.signedScope ?? ''),
    paymentDate: ISO_DATE.test(value.paymentDate ?? '') && !Number.isNaN(Date.parse(value.paymentDate)),
  };
}

function receiptBody(value, now = () => new Date()) {
  if (!Number.isFinite(value.amount) || value.amount < 0) {
    throw new Error('receipt amount must be a non-negative number');
  }
  const gates = {
    recipientAcceptance: optionalString(value.recipientAcceptance) ?? null,
    paymentDate: optionalString(value.paymentDate) ?? null,
    signedScope: optionalString(value.signedScope) ?? null,
  };
  const ok = receiptGateFormat(gates);
  const notFuture = ok.paymentDate && Date.parse(gates.paymentDate) <= now().getTime();
  return {
    counterparty: requiredString(value.counterparty, 'counterparty'),
    what: requiredString(value.what, 'what'),
    amount: value.amount,
    ...(optionalString(value.currency) ? { currency: optionalString(value.currency) } : {}),
    ...gates,
    counted: ok.recipientAcceptance && ok.signedScope && Boolean(notFuture),
  };
}

export function buildAuthorityGrant(input, now, policy = DEFAULT_POLICY) {
  const value = requireInput(input, 'AuthorityGrant');
  const role = requiredString(value.role, 'role');
  const scope = requiredString(value.scope, 'scope');
  const actionClass = normalizeAuthorityClass(value.actionClass);
  if (actionClass === 'advise' || actionClass === 'draft') {
    throw new Error(`a grant is only meaningful for reversible or irreversible actions (got ${actionClass})`);
  }
  const budget = value.budget;
  if (budget !== null && budget !== undefined && !(Number.isFinite(budget) && budget >= 0)) {
    throw new Error('grant budget must be a non-negative number or null');
  }
  const expiresAt = requiredString(value.expiresAt, 'expiresAt');
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new Error('grant expiresAt must be an ISO timestamp');
  }
  if (!isFounderPrincipal(value.grantedBy, policy)) {
    throw new Error('only the founder grants authority');
  }
  const body = {
    role,
    scope,
    actionClass,
    budget: budget ?? null,
    spent: nonNegativeNumber(value.spent ?? 0, 'spent'),
    grantedBy: value.grantedBy,
    expiresAt,
    revokedAt: null,
  };
  return envelope({
    kind: 'AuthorityGrant',
    dedupeKey: value.dedupeKey ?? businessKey(`grant-${role}-${actionClass}`, scope),
    value,
    now,
    body,
  });
}

export function buildAuditEntry(input, now) {
  const value = requireInput(input, 'AuditEntry');
  const outcome = requiredString(value.outcome, 'outcome').toLowerCase();
  if (!['allowed', 'refused'].includes(outcome)) {
    throw new Error(`invalid audit outcome: ${outcome}`);
  }
  const body = {
    actor: requiredString(value.actor, 'actor'),
    action: requiredString(value.action, 'action'),
    actionClass: normalizeAuthorityClass(value.actionClass),
    outcome,
    ...(optionalString(value.reason) ? { reason: optionalString(value.reason) } : {}),
    ...(optionalString(value.grantId) ? { grantId: optionalString(value.grantId) } : {}),
    ...(optionalString(value.receiptId) ? { receiptId: optionalString(value.receiptId) } : {}),
    ...(optionalString(value.unitKey) ? { unitKey: optionalString(value.unitKey) } : {}),
  };
  return envelope({
    kind: 'AuditEntry',
    dedupeKey: `audit:${randomUUID()}`,
    value,
    now,
    body,
  });
}

function envelope({ kind, dedupeKey, value, now, body }) {
  assertCompanyKind(kind);
  const temporal = biTemporal(value, now);
  const predecessorId = optionalString(value.supersedes);
  const disambiguator = predecessorId ? `${predecessorId}\n${temporal.ingestedAt}` : '';
  return {
    id: value.id ?? companyRecordId(kind, dedupeKey, disambiguator),
    kind,
    schemaVersion: COMPANY_SCHEMA_VERSION,
    dedupeKey,
    validFrom: temporal.validFrom,
    validTo: null,
    eventAt: temporal.eventAt,
    ingestedAt: temporal.ingestedAt,
    supersededById: null,
    provenance: normalizeProvenance(value.provenance ?? DEFAULT_PROVENANCE),
    ...(optionalString(value.label) ? { label: normalizeLabel(value.label) } : {}),
    ...(predecessorId ? { supersedes: predecessorId } : {}),
    ...body,
  };
}

function requireInput(input, label) {
  if (!isPlainObject(input)) {
    throw new Error(`${label} input must be a plain object`);
  }
  return input;
}

function requireEvidenceIds(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} requires at least one id`);
  }
  return value.map((entry) => requiredString(entry, `${label} entry`));
}

function normalizeIdeaVariants(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error('idea variants must be an array');
  }
  return value.map((variant, index) => {
    if (!isPlainObject(variant)) {
      throw new Error(`variant ${index + 1} must be an object`);
    }
    const rank = variant.rank;
    if (rank !== undefined && !(Number.isInteger(rank) && rank > 0)) {
      throw new Error(`variant ${index + 1} rank must be a positive integer`);
    }
    return {
      title: requiredString(variant.title, `variant ${index + 1} title`),
      angle: requiredString(variant.angle, `variant ${index + 1} angle`),
      oneLiner: requiredString(variant.oneLiner, `variant ${index + 1} oneLiner`),
      firstBuild: requiredString(variant.firstBuild, `variant ${index + 1} firstBuild`),
      why10x: requiredString(variant.why10x, `variant ${index + 1} why10x`),
      ...(rank ? { rank } : {}),
    };
  });
}

function requireChosenVariants(value, variants) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
    throw new Error('chosenVariants must be an array of variant titles');
  }
  const titles = new Set(variants.map((variant) => variant.title));
  for (const title of value) {
    if (!titles.has(title)) {
      throw new Error(`chosen variant not in the amplification: ${title}`);
    }
  }
  return [...value];
}

function assertRequired(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function nonNegativeNumber(value, label) {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

// Full shape check for anything about to be persisted. The builders are the
// supported constructors; this is the store-side backstop so a hand-built
// record cannot smuggle in a state, grant, or metric the builders refuse.
export function assertCompanyRecordShape(record, policy = DEFAULT_POLICY) {
  if (!isPlainObject(record)) {
    throw new Error('company record must be a plain object');
  }
  assertCompanyKind(record.kind);
  requiredString(record.id, 'record.id');
  if (kindForRecordId(record.id) !== record.kind) {
    throw new Error(`record id ${record.id} does not belong to kind ${record.kind}`);
  }
  requiredString(record.dedupeKey, 'record.dedupeKey');
  requiredString(record.validFrom, 'record.validFrom');
  if (Number.isNaN(Date.parse(record.validFrom))) {
    throw new Error(`record.validFrom must be an ISO timestamp: ${record.validFrom}`);
  }
  requiredString(record.eventAt, 'record.eventAt');
  if (Number.isNaN(Date.parse(record.eventAt))) {
    throw new Error(`record.eventAt must be an ISO timestamp: ${record.eventAt}`);
  }
  requiredString(record.ingestedAt, 'record.ingestedAt');
  if (Number.isNaN(Date.parse(record.ingestedAt))) {
    throw new Error(`record.ingestedAt must be an ISO timestamp: ${record.ingestedAt}`);
  }
  if (record.schemaVersion !== COMPANY_SCHEMA_VERSION) {
    throw new Error(`record.schemaVersion must be ${COMPANY_SCHEMA_VERSION}`);
  }
  normalizeProvenance(record.provenance);
  if (record.validTo !== null && record.validTo !== undefined) {
    requiredString(record.validTo, 'record.validTo');
    if (Number.isNaN(Date.parse(record.validTo))) {
      throw new Error(`record.validTo must be an ISO timestamp: ${record.validTo}`);
    }
  }
  if (record.supersededById !== null && record.supersededById !== undefined) {
    requiredString(record.supersededById, 'record.supersededById');
    if (kindForRecordId(record.supersededById) !== record.kind) {
      throw new Error('record.supersededById must name a record of the same kind');
    }
  }
  if (record.label !== undefined) normalizeLabel(record.label);
  assertKindBody(record, policy);
  return record;
}

function assertKindBody(record, policy) {
  switch (record.kind) {
    case 'BusinessUnit': {
      requiredString(record.title, 'title');
      normalizeBusinessStage(record.stage, policy);
      requiredString(record.goal, 'goal');
      requireEvidenceIds(record.evidence, 'unit evidence');
      requiredString(record.verification, 'verification');
      requiredString(record.killCriterion, 'killCriterion');
      requiredString(record.ownerRole, 'ownerRole');
      requiredString(record.reviewRole, 'reviewRole');
      if (record.ownerRole === record.reviewRole) {
        throw new Error('review role must differ from owner role');
      }
      const authorityClass = normalizeAuthorityClass(record.authorityClass);
      const state = normalizeUnitState(record.state);
      if (
        (authorityClass === 'reversible' || authorityClass === 'irreversible') &&
        !optionalString(record.actionScope)
      ) {
        throw new Error('a reversible or irreversible unit needs an actionScope');
      }
      if (state === 'planned') {
        for (const field of ['reviewer', 'reviewReceiptId', 'founderReceiptId', 'reason']) {
          if (record[field] !== undefined) {
            throw new Error(`a planned unit cannot carry ${field}`);
          }
        }
      }
      if (state === 'shipped') {
        requiredString(record.reviewer, 'reviewer');
        requiredString(record.reviewReceiptId, 'reviewReceiptId');
        if (record.reviewer === record.ownerRole) {
          throw new Error('an executor cannot review its own unit');
        }
        if (authorityClass === 'irreversible') {
          requiredString(record.founderReceiptId, 'founderReceiptId');
        }
      }
      if (state === 'approved' && (authorityClass === 'reversible' || authorityClass === 'irreversible')) {
        requiredString(record.grantId, 'grantId');
        requiredString(record.approvedBy, 'approvedBy');
      }
      if ((state === 'held' || state === 'killed') && !optionalString(record.reason)) {
        throw new Error(`a ${state} unit must say why`);
      }
      break;
    }
    case 'BusinessDecision': {
      const type = requiredString(record.type, 'type');
      if (!DECISION_TYPES.includes(type)) throw new Error(`invalid decision type: ${type}`);
      const scope = requiredString(record.scope, 'scope');
      if (!DECISION_SCOPES.includes(scope)) throw new Error(`invalid decision scope: ${scope}`);
      requiredString(record.statement, 'statement');
      requiredString(record.rationale, 'rationale');
      const status = requiredString(record.status, 'status');
      if (!['open', 'decided'].includes(status)) throw new Error(`invalid decision status: ${status}`);
      if (status === 'decided') {
        const decidedBy = requiredString(record.decidedBy, 'decidedBy');
        if (type === 'lever' && !isFounderPrincipal(decidedBy, policy)) {
          throw new Error('a decided lever must be decided by the founder');
        }
      }
      break;
    }
    case 'BusinessMetric': {
      requiredString(record.name, 'name');
      if (record.value !== null && !Number.isFinite(record.value)) {
        throw new Error('metric value must be a finite number or null');
      }
      requiredString(record.asOf, 'asOf');
      requiredString(record.definition, 'definition');
      normalizeEvidenceClass(record.evidenceClass);
      break;
    }
    case 'BusinessRule': {
      requiredString(record.role, 'role');
      requiredString(record.statement, 'statement');
      requiredString(record.rationale, 'rationale');
      requiredString(record.receiptId, 'receiptId');
      const status = requiredString(record.status, 'status');
      if (!RULE_STATUSES.includes(status)) throw new Error(`invalid rule status: ${status}`);
      if (status === 'pruned') requiredString(record.pruneReason, 'pruneReason');
      break;
    }
    case 'BusinessStage': {
      normalizeBusinessStage(record.stage, policy);
      requireEvidenceIds(record.evidenceIds, 'stage evidence');
      break;
    }
    case 'BusinessIdea': {
      requiredString(record.statement, 'statement');
      const status = normalizeIdeaStatus(record.status);
      const variants = normalizeIdeaVariants(record.variants);
      if (variants.length > 0 && status === 'seed') {
        throw new Error('an idea with variants is at least amplified');
      }
      if (variants.length === 0 && status !== 'seed' && status !== 'dropped') {
        throw new Error(`a ${status} idea needs variants`);
      }
      const chosenVariants = requireChosenVariants(record.chosenVariants, variants);
      if (['decided', 'building', 'shipped'].includes(status) && chosenVariants.length === 0) {
        throw new Error(`a ${status} idea needs at least one chosen variant`);
      }
      normalizeIdeaEvaluation(record.evaluation);
      break;
    }
    case 'BusinessMeasure': {
      const body = measureBody({ ...record, prereg: record.prereg ?? undefined });
      if (record.reportable !== body.reportable) {
        throw new Error('measure reportable must be signed and preregistered');
      }
      break;
    }
    case 'BusinessReceipt': {
      receiptBody({
        ...record,
        recipientAcceptance: record.recipientAcceptance ?? undefined,
        paymentDate: record.paymentDate ?? undefined,
        signedScope: record.signedScope ?? undefined,
      });
      const fmt = receiptGateFormat(record);
      if (record.counted !== false && !(record.counted === true && fmt.recipientAcceptance && fmt.signedScope && fmt.paymentDate)) {
        throw new Error('receipt counted needs recipient acceptance, payment date and signed scope');
      }
      break;
    }
    case 'AuthorityGrant': {
      requiredString(record.role, 'role');
      requiredString(record.scope, 'scope');
      const actionClass = normalizeAuthorityClass(record.actionClass);
      if (actionClass !== 'reversible' && actionClass !== 'irreversible') {
        throw new Error(`a grant is only meaningful for reversible or irreversible actions (got ${actionClass})`);
      }
      if (record.budget !== null && !(Number.isFinite(record.budget) && record.budget >= 0)) {
        throw new Error('grant budget must be a non-negative number or null');
      }
      if (!(Number.isFinite(record.spent) && record.spent >= 0)) {
        throw new Error('grant spent must be a non-negative number');
      }
      if (!isFounderPrincipal(record.grantedBy, policy)) throw new Error('only the founder grants authority');
      requiredString(record.expiresAt, 'expiresAt');
      if (Number.isNaN(Date.parse(record.expiresAt))) {
        throw new Error('grant expiresAt must be an ISO timestamp');
      }
      break;
    }
    case 'AuditEntry': {
      requiredString(record.actor, 'actor');
      requiredString(record.action, 'action');
      normalizeAuthorityClass(record.actionClass);
      const outcome = requiredString(record.outcome, 'outcome');
      if (!['allowed', 'refused'].includes(outcome)) {
        throw new Error(`invalid audit outcome: ${outcome}`);
      }
      break;
    }
    default:
      throw new Error(`no shape validator for ${record.kind}`);
  }
}
