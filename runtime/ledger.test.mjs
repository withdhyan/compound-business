import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { addRecord, countedTotal, listLedger, updateRecord } from './ledger.mjs';
import { getItems } from './memory.mjs';
import { buildPolicy } from './policy.mjs';
import { assertCompanyRecordShape, buildBusinessMeasure, buildBusinessReceipt } from './records.mjs';
import { createCompanyStore } from './store.mjs';

const now = () => new Date('2026-11-10T10:00:00.000Z');
const policy = buildPolicy({ founders: ['founder'], principals: { founder: 'personal', analyst: 'founders' } });

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-ledger-'));
  const store = createCompanyStore({ dataDir, policy });
  return { store, ctx: { store, policy, dataDir, memoryDirs: [path.join(dataDir, 'memory')] } };
}

const measure = (overrides = {}) => ({
  instrument: 'retention survey',
  partner: 'partner-lab',
  signed: false,
  prereg: null,
  threshold: '>= 40% at day 30',
  population: 'first cohort, n=30',
  ...overrides,
});

const receipt = (overrides = {}) => ({
  counterparty: 'funder-a',
  what: 'grant',
  amount: 50000,
  currency: 'USD',
  ...overrides,
});

test('a measure carries instrument, partner, signed, prereg, threshold, population', () => {
  const m = buildBusinessMeasure(measure(), now);
  assert.match(m.id, /^bmeas_[0-9a-f]{24}$/);
  assert.equal(m.reportable, false);
  for (const field of ['instrument', 'partner', 'threshold', 'population']) {
    assert.throws(() => buildBusinessMeasure(measure({ [field]: '' }), now), new RegExp(field));
  }
  assert.throws(() => buildBusinessMeasure(measure({ signed: 'yes' }), now), /signed must be a boolean/);
});

test('a measure is reportable only when signed and preregistered', () => {
  assert.equal(buildBusinessMeasure(measure({ signed: true }), now).reportable, false);
  assert.equal(buildBusinessMeasure(measure({ prereg: 'prereg-2026-11' }), now).reportable, false);
  const ok = buildBusinessMeasure(measure({ signed: true, prereg: 'prereg-2026-11' }), now);
  assert.equal(ok.reportable, true);
  assert.throws(() => assertCompanyRecordShape({ ...ok, reportable: false }), /reportable/);
  assert.throws(
    () => assertCompanyRecordShape({ ...buildBusinessMeasure(measure(), now), reportable: true }),
    /reportable/,
  );
});

test('money counts only with recipient acceptance, payment date and signed scope', () => {
  assert.equal(buildBusinessReceipt(receipt(), now).counted, false);
  const partial = { recipientAcceptance: 'email 2026-11-08', paymentDate: '2026-12-01' };
  assert.equal(buildBusinessReceipt(receipt(partial), now).counted, false);
  const full = buildBusinessReceipt(receipt({ ...partial, signedScope: 'scope-v2.pdf' }), now);
  assert.equal(full.counted, true);
  assert.match(full.id, /^brcpt_[0-9a-f]{24}$/);
  assert.throws(() => assertCompanyRecordShape({ ...buildBusinessReceipt(receipt(), now), counted: true }), /counted/);
  assert.throws(() => buildBusinessReceipt(receipt({ amount: -1 }), now), /amount/);
  assert.throws(() => buildBusinessReceipt(receipt({ paymentDate: 'soon' }), now), /paymentDate/);
});

test('countedTotal separates counted money from promised money', () => {
  const a = buildBusinessReceipt(receipt({ counterparty: 'a', recipientAcceptance: 'x', paymentDate: '2026-12-01', signedScope: 's' }), now);
  const b = buildBusinessReceipt(receipt({ counterparty: 'b', amount: 20000 }), now);
  const total = countedTotal([a, b]);
  assert.equal(total.counted, 50000);
  assert.equal(total.uncounted, 20000);
  assert.deepEqual(total.missing.map((row) => [row.counterparty, row.lacks]), [['b', ['recipientAcceptance', 'paymentDate', 'signedScope']]]);
});

test('ledger add, list and update supersede, keep the label, and are readable via get', async () => {
  const { store, ctx } = await setup();
  const first = await addRecord(store, 'receipt', receipt(), { label: 'founders' });
  assert.equal(first.label, 'founders');
  await assert.rejects(() => addRecord(store, 'receipt', receipt()), /label is required/);
  const second = await updateRecord(store, first.id, { recipientAcceptance: 'email 2026-11-08', paymentDate: '2026-12-01', signedScope: 'scope.pdf' });
  assert.equal(second.counted, true);
  assert.equal(second.label, 'founders');
  assert.equal(second.amount, 50000);
  const live = await listLedger(store, 'receipt');
  assert.equal(live.length, 1);
  assert.equal(live[0].id, second.id);
  // predecessor stays readable, superseded
  const hits = await getItems(ctx, 'analyst', 'funder-a');
  assert.ok(hits.results.some((row) => row.id === first.id && row.superseded));
  assert.deepEqual((await getItems(ctx, 'founder', 'funder-a')).results.length >= 1, true);
});

test('a measure record is retrievable only inside its label', async () => {
  const { store, ctx } = await setup();
  await addRecord(store, 'measure', measure(), { label: 'founders' });
  const low = buildPolicy({ founders: ['founder'], principals: { founder: 'personal', scribe: 'team' } });
  const lowCtx = { ...ctx, policy: low, store: createCompanyStore({ dataDir: ctx.dataDir, policy: low }) };
  assert.deepEqual((await getItems(lowCtx, 'scribe', 'retention survey')).results, []);
  assert.equal((await getItems(ctx, 'founder', 'retention survey')).results.length, 1);
});
