import { normalizeLabel } from './policy.mjs';
import { RECEIPT_GATES, buildBusinessMeasure, buildBusinessReceipt } from './records.mjs';

// Writes for the two ledger kinds: measures (the research registry) and
// receipts (the money gate). Both are labelled records, retrievable with
// `cb get`, and corrected only by supersession.
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
// patch over the old fields, and re-derives `reportable` / `counted`.
export async function updateRecord(store, id, patch) {
  const old = await store.readRecord(id);
  const entry = Object.values(KINDS).find(({ kind }) => kind === old?.kind);
  if (!entry || old.validTo || old.supersededById) throw new Error(`no live ledger record: ${id}`);
  const fields = { ...old };
  for (const key of ['id', 'kind', 'schemaVersion', 'validFrom', 'validTo', 'eventAt', 'ingestedAt', 'supersededById', 'supersedes', 'provenance']) {
    delete fields[key];
  }
  const record = entry.build(
    { ...fields, ...patch, label: old.label, dedupeKey: old.dedupeKey, supersedes: old.id, eventAt: new Date().toISOString() },
    () => new Date(),
  );
  await store.supersedeRecord(old.id, record);
  return record;
}

export async function listLedger(store, name) {
  return store.liveRecords(spec(name).kind);
}

// Money counts only past the receipt gate; the rest is promised, not counted.
export function countedTotal(receipts) {
  let counted = 0;
  let uncounted = 0;
  const missing = [];
  for (const row of receipts) {
    if (row.counted) {
      counted += row.amount;
    } else {
      uncounted += row.amount;
      missing.push({
        id: row.id,
        counterparty: row.counterparty,
        lacks: RECEIPT_GATES.filter((gate) => row[gate] === null || row[gate] === undefined),
      });
    }
  }
  return { counted, uncounted, missing };
}
