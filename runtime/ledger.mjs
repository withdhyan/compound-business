import { canRead, isFounderPrincipal, normalizeLabel } from './policy.mjs';
import { buildBusinessMeasure, buildBusinessReceipt, receiptGateFormat } from './records.mjs';
import { requiredString } from './kernel.mjs';
import { showItem } from './memory.mjs';

// Writes for the two ledger kinds: measures (the research registry) and
// receipts (the money gate). Both are labelled records, retrievable with
// `cb get`, and corrected only by supersession.
//
// addRecord / updateRecord / listLedger are the store-level primitives. The
// CLI never exposes them without a principal: reads are label-filtered
// (listLedgerFor) and writes are founder-only and check that cited evidence
// resolves (checkedPatch). Agents propose a memory item instead.
const KINDS = Object.freeze({
  measure: { kind: 'BusinessMeasure', build: buildBusinessMeasure },
  receipt: { kind: 'BusinessReceipt', build: buildBusinessReceipt },
});

function spec(name) {
  const found = KINDS[name];
  if (!found) throw new Error(`ledger kind must be one of: ${Object.keys(KINDS).join(', ')}`);
  return found;
}

export async function addRecord(store, name, input, options = {}) {
  const { build } = spec(name);
  if (!options.label) throw new Error('label is required');
  const record = build({ ...input, label: normalizeLabel(options.label) }, () => new Date());
  await store.writeRecord(record);
  return record;
}

// Patch a live record: the successor keeps the label and dedupe key, takes the
// patch over the old fields, and re-derives `reportable` / `counted`. A patch
// cannot choose ids, timestamps, provenance or the label.
const ENVELOPE = ['id', 'kind', 'schemaVersion', 'validFrom', 'validTo', 'eventAt', 'ingestedAt', 'supersededById', 'supersedes', 'provenance', 'label', 'dedupeKey', 'counted', 'reportable'];

export async function updateRecord(store, id, patch) {
  const old = await store.readRecord(id);
  const entry = Object.values(KINDS).find(({ kind }) => kind === old?.kind);
  if (!entry || old.validTo || old.supersededById) throw new Error(`no live ledger record: ${id}`);
  const fields = { ...old };
  for (const key of ENVELOPE) delete fields[key];
  const clean = { ...patch };
  for (const key of ENVELOPE) delete clean[key];
  const record = entry.build(
    { ...fields, ...clean, label: old.label, dedupeKey: old.dedupeKey, supersedes: old.id, eventAt: new Date().toISOString() },
    () => new Date(),
  );
  await store.supersedeRecord(old.id, record);
  return record;
}

export async function listLedger(store, name) {
  return store.liveRecords(spec(name).kind);
}

// Only the records this principal's grant can read; the receipt totals are
// computed on that filtered list.
export async function listLedgerFor(ctx, principal, name) {
  requiredString(principal, 'principal');
  const rows = (await listLedger(ctx.store, name)).filter(
    (row) => row.label && canRead(ctx.policy, principal, row.label, null, { id: row.id, path: `company/${row.kind}/${row.id}.json` }),
  );
  return { kind: name, records: rows, ...(name === 'receipt' ? { totals: countedTotal(rows) } : {}) };
}

// Ledger writes need a founder, and acceptance / signed-scope evidence must be
// memory items that resolve in that founder's grant.
export async function guardLedgerWrite(ctx, principal, input) {
  if (!isFounderPrincipal(principal, ctx.policy)) throw new Error('only a founder writes ledger records');
  const gates = receiptGateFormat(input);
  for (const field of ['recipientAcceptance', 'signedScope']) {
    if (input[field] === undefined || input[field] === null) continue;
    if (!gates[field]) throw new Error(`${field} must be a memory item id (store the document, then cite it)`);
    await showItem(ctx, principal, input[field]).catch(() => {
      throw new Error(`${field} does not resolve to a readable item: ${input[field]}`);
    });
  }
}

// Money counts only past the receipt gate; the rest is promised, not counted.
// Totals are per currency: amounts in different currencies are never added.
export function countedTotal(receipts) {
  const counted = {};
  const uncounted = {};
  const missing = [];
  const add = (bucket, row) => {
    const currency = row.currency ?? 'unspecified';
    bucket[currency] = (bucket[currency] ?? 0) + row.amount;
  };
  for (const row of receipts) {
    if (row.counted) {
      add(counted, row);
    } else {
      add(uncounted, row);
      const ok = receiptGateFormat(row);
      const lacks = ['recipientAcceptance', 'paymentDate', 'signedScope'].filter((gate) => !ok[gate]);
      missing.push({ id: row.id, counterparty: row.counterparty, lacks: lacks.length ? lacks : ['paymentDate not reached'] });
    }
  }
  return { counted, uncounted, missing };
}
