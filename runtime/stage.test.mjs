import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STAGE_CATALOG,
  assessStageMove,
  nextStage,
  planStageAdvance,
  stageIndex,
} from './stage.mjs';

function evidence(criterion, evidenceClass = 'measured') {
  return { criterion, recordId: `bmet_${criterion}`, evidenceClass };
}

const validationEvidence = [
  evidence('demand_evidence'),
  evidence('status_quo_cost'),
  evidence('desperate_specificity'),
];

test('the stage ladder is ordered and names its constraints', () => {
  assert.equal(stageIndex('idea'), 0);
  assert.equal(stageIndex('scale'), 6);
  assert.equal(nextStage('idea'), 'validation');
  assert.equal(nextStage('scale'), null);
  for (const [stage, entry] of Object.entries(STAGE_CATALOG)) {
    assert.ok(entry.bindingConstraint.length > 0, `${stage} needs a binding constraint`);
    assert.ok(entry.exitCriteria.length > 0, `${stage} needs exit criteria`);
  }
});

test('a forward move needs every exit criterion covered by real evidence', () => {
  const pass = assessStageMove({ from: 'idea', to: 'validation', evidence: validationEvidence });
  assert.equal(pass.allowed, true);
  assert.equal(pass.refusals.length, 0);
  assert.equal(pass.evidenceIds.length, 3);

  const missing = assessStageMove({ from: 'idea', to: 'validation', evidence: [evidence('demand_evidence')] });
  assert.equal(missing.allowed, false);
  assert.match(missing.refusals.join(' '), /missing evidence for status_quo_cost/);

  const assumed = assessStageMove({
    from: 'idea',
    to: 'validation',
    evidence: [
      evidence('demand_evidence', 'assumed'),
      evidence('status_quo_cost', 'assumed'),
      evidence('desperate_specificity', 'measured'),
    ],
  });
  assert.equal(assumed.allowed, false);
  assert.match(assumed.refusals.join(' '), /only by assumed evidence/);
});

test('evidence classes outside the closed enum are refused, never counted as real', () => {
  assert.throws(
    () => assessStageMove({
      from: 'idea',
      to: 'validation',
      evidence: [
        { criterion: 'demand_evidence', recordId: 'x', evidenceClass: 'fabricated' },
      ],
    }),
    /invalid evidence class/,
  );

  const upper = assessStageMove({
    from: 'idea',
    to: 'validation',
    evidence: [
      evidence('demand_evidence', 'ASSUMED'),
      evidence('status_quo_cost', 'ASSUMED'),
      evidence('desperate_specificity', 'ASSUMED'),
    ],
  });
  assert.equal(upper.allowed, false);
  assert.equal(upper.refusals.length, 3);
});

test('stages cannot be skipped, and a backward move needs a founder lever', () => {  const skip = assessStageMove({ from: 'idea', to: 'first_revenue', evidence: validationEvidence });
  assert.equal(skip.allowed, false);
  assert.match(skip.refusals.join(' '), /cannot skip a stage/);

  const same = assessStageMove({ from: 'validation', to: 'validation' });
  assert.equal(same.allowed, false);

  const backward = assessStageMove({ from: 'validation', to: 'idea' });
  assert.equal(backward.allowed, false);
  assert.match(backward.refusals.join(' '), /founder lever/);

  const ruled = assessStageMove({
    from: 'validation',
    to: 'idea',
    decision: { type: 'lever', decidedBy: 'founder', statement: 'Wedge disproved; return to problem' },
  });
  assert.equal(ruled.allowed, true);
});

test('planStageAdvance only produces a proposal when the move is allowed', () => {
  const proposal = planStageAdvance({ from: 'idea', to: 'validation', evidence: validationEvidence });
  assert.equal(proposal.kind, 'StageAdvanceProposal');
  assert.equal(proposal.from, 'idea');
  assert.equal(proposal.to, 'validation');
  assert.equal(Object.isFrozen(proposal), true);

  assert.throws(
    () => planStageAdvance({ from: 'idea', to: 'pmf', evidence: [] }),
    /stage advance refused/,
  );
});
