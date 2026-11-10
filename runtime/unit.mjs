import {
  isPlainObject,
  requiredString,
} from './kernel.mjs';
import {
  UNIT_TRANSITIONS,
  buildBusinessUnit,
  normalizeUnitState,
} from './records.mjs';
import { authorizeStoredAction } from './ladder.mjs';

// Business moves are units. Transitions happen only through transitionUnit:
// a new state or edge is an ADR-level change, never a local patch. Shipping
// needs a review receipt from a different role; a reversible or irreversible
// unit needs a live founder grant (resolved from the store by id) to be
// approved, and an irreversible unit additionally needs a founder receipt; a
// hold or a kill must say why (the reason is content). Review and receipt ids
// persist onto the successor so the shipped record carries its own evidence,
// and the store independently refuses a non-planned first record or an illegal
// history edge.
export function assertUnitTransition(unit, nextState) {
  const current = normalizeUnitState(unit?.state);
  const next = normalizeUnitState(nextState);
  const allowed = UNIT_TRANSITIONS[current] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`unit transition refused: ${current} → ${next}`);
  }
  return next;
}

export async function transitionUnit(unit, nextState, context = {}, now) {
  if (!isPlainObject(unit) || unit.kind !== 'BusinessUnit') {
    throw new Error('transitionUnit needs a BusinessUnit');
  }
  const next = assertUnitTransition(unit, nextState);
  const actor = requiredString(context.actor, 'actor');
  const at = requiredString(context.at, 'at');
  if (Number.isNaN(Date.parse(at))) {
    throw new Error('transition at must be an ISO timestamp');
  }

  let approval = null;
  if (next === 'approved' && (unit.authorityClass === 'reversible' || unit.authorityClass === 'irreversible')) {
    const authorization = await authorizeStoredAction({
      store: context.store,
      grantIds: context.grantIds ?? [],
      actionClass: unit.authorityClass,
      actor,
      action: `unit:approve:${unit.dedupeKey}`,
      scope: requiredString(unit.actionScope, 'unit.actionScope'),
      founderReceiptId: context.founderReceiptId,
      brakeEngaged: context.brakeEngaged,
      at,
    });
    if (!authorization.allowed) {
      throw new Error(`unit approval refused: ${authorization.audit.reason}`);
    }
    approval = { grantId: authorization.audit.grantId, approvedBy: actor };
  }

  if (next === 'shipped') {
    requiredString(context.reviewReceiptId, 'reviewReceiptId');
    const reviewer = requiredString(context.reviewer, 'reviewer');
    if (reviewer === unit.ownerRole) {
      throw new Error('an executor cannot review its own unit');
    }
    if (unit.authorityClass === 'irreversible') {
      requiredString(context.founderReceiptId, 'founderReceiptId');
    }
  }

  if (next === 'held' || next === 'killed') {
    requiredString(context.reason, 'reason');
  }

  const clock = now ?? (() => new Date());
  const grantId = approval?.grantId ?? unit.grantId;
  const approvedBy = approval?.approvedBy ?? unit.approvedBy;
  const successor = buildBusinessUnit({
    title: unit.title,
    stage: unit.stage,
    goal: unit.goal,
    evidence: unit.evidence,
    verification: unit.verification,
    killCriterion: unit.killCriterion,
    ownerRole: unit.ownerRole,
    reviewRole: unit.reviewRole,
    authorityClass: unit.authorityClass,
    ...(unit.actionScope ? { actionScope: unit.actionScope } : {}),
    state: next,
    dedupeKey: unit.dedupeKey,
    supersedes: unit.id,
    provenance: unit.provenance,
    eventAt: at,
    ...(context.reviewer ? { reviewer: context.reviewer } : {}),
    ...(context.reviewReceiptId ? { reviewReceiptId: context.reviewReceiptId } : {}),
    ...(context.founderReceiptId ? { founderReceiptId: context.founderReceiptId } : {}),
    ...(grantId ? { grantId } : {}),
    ...(approvedBy ? { approvedBy } : {}),
    ...(context.notes ? { notes: context.notes } : {}),
    ...(context.reason ? { reason: context.reason } : {}),
  }, clock, context.store?.policy);

  return Object.freeze({
    successor,
    transition: Object.freeze({
      from: unit.state,
      to: next,
      actor,
      at,
      ...(context.reviewReceiptId ? { reviewReceiptId: context.reviewReceiptId } : {}),
      ...(context.reviewer ? { reviewer: context.reviewer } : {}),
      ...(context.founderReceiptId ? { founderReceiptId: context.founderReceiptId } : {}),
      ...(context.reason ? { reason: context.reason } : {}),
    }),
  });
}

export function unitIsTerminal(unit) {
  return ['shipped', 'killed'].includes(normalizeUnitState(unit?.state));
}
