import {
  isPlainObject,
  requiredString,
} from './kernel.mjs';
import { DEFAULT_POLICY } from './policy.mjs';
import {
  buildAuthorityGrant,
  isGrantLive,
  normalizeAuthorityClass,
  remainingBudget,
} from './records.mjs';
import { CompanyStore } from './store.mjs';

export { isGrantLive, remainingBudget };

// The authority ladder, fail closed:
//   advise      — no external effect; always allowed
//   draft       — produces text/files for review; always allowed
//   reversible  — needs a live founder grant for this actor, class, and scope;
//                 budget hard-stops
//   irreversible — the above, plus a founder receipt (card)
// Unknown action classes are refused, not coerced. A scoped action with no
// scope, a grant not issued by the founder, or a truthy brake signal all
// refuse. `authorizeAction` is the pure check; wiring uses
// `authorizeStoredAction`/`authorizeAndSpend`, which resolve grants from the
// store and persist spend before execution.

// The wiring-facing gate: grants are resolved from the store by id, never
// trusted as caller-supplied objects. A missing grant id throws (a wiring
// error is never silenced); policy refusals come back like authorizeAction's.
export async function resolveGrant(store, id) {
  if (!(store instanceof CompanyStore)) {
    throw new Error('resolveGrant needs a CompanyStore');
  }
  const record = await store.readRecord(requiredString(id, 'grantId'));
  return record?.kind === 'AuthorityGrant' ? record : null;
}

export async function authorizeStoredAction(input) {
  if (!isPlainObject(input)) {
    throw new Error('authorizeStoredAction input must be a plain object');
  }
  const { store, grantIds, ...rest } = input;
  const grants = [];
  for (const id of grantIds ?? []) {
    const grant = await resolveGrant(store, id);
    if (!grant) {
      throw new Error(`grant not found: ${id}`);
    }
    grants.push(grant);
  }
  return authorizeAction({ ...rest, grants, policy: store.policy });
}

// Authorize and spend in one durable act: the successor grant (with the new
// spent total) is written before the caller executes anything. Without this,
// repeated authorizeAction calls could each pass a stale budget.
export async function authorizeAndSpend(input) {
  const result = await authorizeStoredAction(input);
  if (!result.allowed || !result.spend) {
    return result;
  }
  const grant = await resolveGrant(input.store, result.spend.grantId);
  const at = requiredString(input.at, 'at');
  const atMs = Date.parse(at);
  const validFromMs = Date.parse(grant.validFrom);
  const successorAt = atMs > validFromMs ? at : new Date(validFromMs + 1).toISOString();
  const successor = buildAuthorityGrant({
    role: grant.role,
    scope: grant.scope,
    actionClass: grant.actionClass,
    budget: grant.budget,
    spent: result.spend.spent,
    expiresAt: grant.expiresAt,
    grantedBy: grant.grantedBy,
    dedupeKey: grant.dedupeKey,
    supersedes: grant.id,
    eventAt: successorAt,
  }, () => new Date(successorAt), input.store.policy);
  await input.store.supersedeRecord(grant.id, successor);
  return { ...result, grantId: successor.id };
}

export function authorizeAction(input) {
  if (!isPlainObject(input)) {
    throw new Error('authorizeAction input must be a plain object');
  }
  const actionClass = normalizeAuthorityClass(input.actionClass);
  const actor = requiredString(input.actor, 'actor');
  const action = requiredString(input.action, 'action');
  const at = requiredString(input.at, 'at');
  const grants = Array.isArray(input.grants) ? input.grants : [];
  const policy = input.policy ?? DEFAULT_POLICY;
  const result = (allowed, reason, grantId, receiptId, spend = null) => ({
    allowed,
    actionClass,
    ...(spend ? { spend } : {}),
    audit: Object.freeze({
      actor,
      action,
      actionClass,
      outcome: allowed ? 'allowed' : 'refused',
      ...(reason ? { reason } : {}),
      ...(grantId ? { grantId } : {}),
      ...(receiptId ? { receiptId } : {}),
    }),
  });

  if (actionClass === 'advise' || actionClass === 'draft') {
    return result(true, 'advisory only', null, null);
  }

  // Fail closed on any brake signal that is not an explicit false.
  if (input.brakeEngaged !== undefined && input.brakeEngaged !== false) {
    return result(false, 'emergency brake engaged', null, null);
  }

  const scope = requiredString(input.scope, 'scope');
  const grant = grants.find(
    (candidate) =>
      isGrantLive(candidate, at, policy) &&
      candidate.actionClass === actionClass &&
      candidate.role === actor &&
      candidate.scope === scope,
  );
  if (!grant) {
    return result(false, `no live grant for ${actor}`, null, null);
  }

  const cost = input.cost ?? 0;
  if (!(Number.isFinite(cost) && cost >= 0)) {
    return result(false, 'cost must be a non-negative number', null, null);
  }
  let spend = null;
  if (cost > 0) {
    const remaining = remainingBudget(grant);
    if (remaining === null) {
      return result(false, 'grant has no spend ceiling or non-finite spend', grant.id, null);
    }
    if (cost > remaining) {
      return result(false, 'budget hard stop', grant.id, null);
    }
    spend = Object.freeze({
      grantId: grant.id,
      cost,
      spent: (grant.spent ?? 0) + cost,
      remaining: remaining - cost,
    });
  }

  let founderReceiptId = null;
  if (actionClass === 'irreversible') {
    founderReceiptId = input.founderReceiptId;
    if (typeof founderReceiptId !== 'string' || founderReceiptId.trim() === '') {
      return result(false, 'irreversible action needs a founder receipt', grant.id, null);
    }
  }

  return result(true, null, grant.id, founderReceiptId, spend);
}

// Pure spend math for the successor grant; the caller persists it through
// CompanyStore.supersedeRecord, never by editing the grant in place.
export function applyGrantSpend(grant, cost, at, policy = DEFAULT_POLICY) {
  if (!isPlainObject(grant) || grant.kind !== 'AuthorityGrant') {
    throw new Error('applyGrantSpend needs an AuthorityGrant');
  }
  if (!isGrantLive(grant, at, policy)) {
    throw new Error('grant is not live at that time');
  }
  if (!(Number.isFinite(cost) && cost >= 0)) {
    throw new Error('spend must be a non-negative number');
  }
  if (grant.budget === null) {
    throw new Error('grant has no spend ceiling');
  }
  const spent = (grant.spent ?? 0) + cost;
  if (spent > grant.budget) {
    throw new Error('spend would cross the budget hard stop');
  }
  return Object.freeze({ spent, remaining: grant.budget - spent });
}
