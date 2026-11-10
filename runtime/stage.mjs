import {
  isPlainObject,
  requiredString,
} from './kernel.mjs';
import { DEFAULT_POLICY, isFounderPrincipal } from './policy.mjs';
import {
  BUSINESS_STAGES,
  normalizeBusinessStage,
  normalizeEvidenceClass,
} from './records.mjs';

// The 0→100 stage machine. A stage names its binding constraint — the thing
// that must move to leave it — and the evidence areas a forward move must
// cover. Moves are +1 only; skipping a stage is refused, and going backward
// needs a founder lever. Nothing here writes: assessment returns a decision,
// and only the founder advances the company (see AGENTS.md).
export const STAGE_CATALOG = Object.freeze({
  idea: Object.freeze({
    index: 0,
    bindingConstraint: 'demand reality',
    exitCriteria: Object.freeze([
      'demand_evidence',
      'status_quo_cost',
      'desperate_specificity',
    ]),
  }),
  validation: Object.freeze({
    index: 1,
    bindingConstraint: 'behavior, not interest',
    exitCriteria: Object.freeze([
      'paid_or_committed_demand',
      'repeated_usage',
      'wedge_worth_paying',
    ]),
  }),
  first_revenue: Object.freeze({
    index: 2,
    bindingConstraint: 'paying customers by hand',
    exitCriteria: Object.freeze([
      'first_customers_paid',
      'repeatable_pitch',
      'unit_margin_known',
    ]),
  }),
  pmf: Object.freeze({
    index: 3,
    bindingConstraint: 'retention and pull',
    exitCriteria: Object.freeze([
      'cohort_retention',
      'unprompted_pull',
      'churn_understood',
    ]),
  }),
  growth: Object.freeze({
    index: 4,
    bindingConstraint: 'one channel with positive unit economics',
    exitCriteria: Object.freeze([
      'cac_ltv_positive',
      'channel_loop',
      'capacity_respected',
    ]),
  }),
  default_alive: Object.freeze({
    index: 5,
    bindingConstraint: 'runway, margin, and reliability',
    exitCriteria: Object.freeze([
      'default_alive_math',
      'gross_margin',
      'ops_reliability',
    ]),
  }),
  scale: Object.freeze({
    index: 6,
    bindingConstraint: 'growth without losing the thing',
    exitCriteria: Object.freeze([
      'growth_rate',
      'retention_holds',
      'category_position',
    ]),
  }),
});

// The ladder in force: the policy's configured stages, else the revenue ladder.
export function ladderFor(policy = DEFAULT_POLICY) {
  if (!policy.stages) return { names: BUSINESS_STAGES, catalog: STAGE_CATALOG };
  return {
    names: policy.stageNames,
    catalog: Object.fromEntries(policy.stages.map((stage) => [stage.name, stage])),
  };
}

export function stageIndex(stage, policy = DEFAULT_POLICY) {
  return ladderFor(policy).catalog[normalizeBusinessStage(stage, policy)].index;
}

export function nextStage(stage, policy = DEFAULT_POLICY) {
  const index = stageIndex(stage, policy);
  return ladderFor(policy).names[index + 1] ?? null;
}

export function assessStageMove(input) {
  if (!isPlainObject(input)) {
    throw new Error('stage move input must be a plain object');
  }
  const policy = input.policy ?? DEFAULT_POLICY;
  const from = normalizeBusinessStage(requiredString(input.from, 'from'), policy);
  const to = normalizeBusinessStage(requiredString(input.to, 'to'), policy);
  const fromIndex = stageIndex(from, policy);
  const toIndex = stageIndex(to, policy);
  const refusals = [];

  if (toIndex === fromIndex) {
    return decision(from, to, ['already in this stage'], []);
  }

  if (toIndex > fromIndex + 1) {
    return decision(from, to, ['cannot skip a stage'], []);
  }

  if (toIndex < fromIndex) {
    const lever = isPlainObject(input.decision) ? input.decision : null;
    if (!lever || lever.type !== 'lever' || !isFounderPrincipal(lever.decidedBy, policy)) {
      return decision(from, to, ['a backward move needs a founder lever'], []);
    }
    return decision(from, to, [], [], {
      reason: requiredString(lever.statement ?? 'founder lever', 'decision.statement'),
    });
  }

  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const covered = new Map();
  for (const entry of evidence) {
    if (!isPlainObject(entry)) {
      return decision(from, to, ['evidence entries must be objects'], []);
    }
    const criterion = requiredString(entry.criterion, 'evidence.criterion');
    const recordId = requiredString(entry.recordId, 'evidence.recordId');
    const evidenceClass = normalizeEvidenceClass(entry.evidenceClass ?? 'assumed');
    if (!covered.has(criterion)) covered.set(criterion, []);
    covered.get(criterion).push({ recordId, evidenceClass });
  }

  for (const criterion of ladderFor(policy).catalog[from].exitCriteria) {
    const entries = covered.get(criterion) ?? [];
    if (entries.length === 0) {
      refusals.push(`missing evidence for ${criterion}`);
      continue;
    }
    if (entries.every((entry) => entry.evidenceClass === 'assumed')) {
      refusals.push(`${criterion} is covered only by assumed evidence`);
    }
  }

  return decision(from, to, refusals, evidence.map((entry) => entry.recordId));
}

export function planStageAdvance(input) {
  const assessed = assessStageMove(input);
  if (!assessed.allowed) {
    throw new Error(`stage advance refused: ${assessed.refusals.join('; ')}`);
  }
  return Object.freeze({
    kind: 'StageAdvanceProposal',
    from: assessed.from,
    to: assessed.to,
    evidenceIds: assessed.evidenceIds,
    statement: `Advance ${assessed.from} → ${assessed.to} on ${assessed.evidenceIds.length} evidence record(s).`,
  });
}

function decision(from, to, refusals, evidenceIds, extra = {}) {
  return Object.freeze({
    allowed: refusals.length === 0,
    from,
    to,
    refusals: Object.freeze(refusals),
    evidenceIds: Object.freeze(evidenceIds),
    ...extra,
  });
}
