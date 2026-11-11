import { optionalString, requiredString } from './kernel.mjs';
import { extractCitations, showItem } from './memory.mjs';
import { LABELS, canRead, isFounderPrincipal } from './policy.mjs';
import { TRIAGE_CLASSES, buildBusinessTrace, traceKey } from './records.mjs';
import { serializeByDataDir } from './store.mjs';

// Decision traces. Curation keeps the context behind each decision (what was
// proposed, on which inputs, what was edited, what was decided, what happened
// later) so the learning can be reused without every correction becoming a
// rule. A trace is a BusinessTrace record: superseded, never mutated.
//
// The label is the max of the labels it references (the proposal, the item it
// edits, every cited evidence item), so no reader gets a trace whose inputs
// they could not read. A pending trace is visible only to founders and to its
// proposer: the title of an invisible proposal must not leak through it.
//
// Functions marked "locked" run inside a caller's per-dataDir critical section
// (curation holds it); the others take the lock themselves.
const KIND = 'BusinessTrace';
const clip = (value, max = 300) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export function maxLabel(labels) {
  return labels.reduce((top, label) => (LABELS.indexOf(label) > LABELS.indexOf(top) ? label : top), 'public');
}

// The ids a proposal rests on (the edited item plus every cited evidence id)
// and the label that covers them all. Ids the proposer cannot read are not
// recorded (propose has already refused them as evidence).
export async function traceContext(ctx, who, label, { supersedes, evidence } = {}) {
  const ids = [...new Set([...(supersedes ? [supersedes] : []), ...extractCitations((evidence ?? []).join('\n')).map((c) => c.id)])];
  const labels = [label];
  const contextIds = [];
  const owners = new Set();
  for (const id of ids) {
    const item = await showItem(ctx, who, id).catch(() => null);
    if (!item) continue;
    contextIds.push(id);
    labels.push(item.label);
    // `personal` is owner-only, so the reader of a personal item is its owner.
    if (item.label === 'personal') owners.add(who);
  }
  const top = maxLabel(labels);
  if (top !== 'personal') return { contextIds, label: top };
  // A personal trace belongs to the owner of the personal items it cites (or of
  // the personal proposal itself). Never to a default owner: no owner, or more
  // than one, and the proposal is refused.
  if (label === 'personal') owners.add(who);
  if (owners.size !== 1) throw new Error('a personal trace needs exactly one owner');
  return { contextIds, label: top, owner: [...owners][0] };
}

// locked
export async function openTrace(ctx, { proposalId, subject, proposedBy, owner, label, contextIds }) {
  const all = (await ctx.store.listRecords(KIND)).filter((row) => row.proposalId === proposalId);
  const seq = Math.max(-1, ...all.map((row) => Number(row.dedupeKey.split(':').pop()))) + 1;
  const record = buildBusinessTrace(
    { proposalId, subject, proposedBy, owner: label === 'personal' ? requiredString(owner, 'owner') : undefined, label, contextIds, dedupeKey: traceKey(proposalId, seq) },
    () => new Date(),
  );
  await ctx.store.writeRecordNow(record);
  return record;
}

async function pendingTrace(ctx, proposalId) {
  return (await ctx.store.liveRecords(KIND)).find((row) => row.proposalId === proposalId && row.decision === 'pending') ?? null;
}

// locked. Supersede the live trace with `patch` applied; the label, identity
// and dedupeKey are carried over. validFrom is forced strictly after the
// predecessor's so two steps in one millisecond still order.
async function successor(ctx, old, patch) {
  const fields = {};
  for (const key of ['subject', 'proposalId', 'proposedBy', 'owner', 'contextIds', 'edits', 'decision', 'decisionId', 'decidedBy', 'decidedAt', 'decisionNote', 'outcome', 'triage', 'suggestions']) {
    fields[key] = old[key];
  }
  const at = new Date(Math.max(Date.now(), Date.parse(old.validFrom) + 1)).toISOString();
  const record = buildBusinessTrace(
    { ...fields, ...patch, label: patch.label ?? old.label, dedupeKey: old.dedupeKey, supersedes: old.id, validFrom: at, eventAt: at, ingestedAt: at },
    () => new Date(at),
  );
  await ctx.store.supersedeRecordNow(old.id, record);
  return record;
}

// locked. Curation calls these; a proposal that predates traces has none, and
// the step simply goes unrecorded.
export async function recordEdits(ctx, proposalId, by, changes) {
  const old = await pendingTrace(ctx, proposalId);
  if (!old || changes.length === 0) return null;
  const at = new Date().toISOString();
  const edits = [...old.edits, ...changes.map((c) => ({ at, by, field: c.field, from: clip(c.from), to: clip(c.to) }))];
  // The edit's new text may cite items above the trace label: the label rises
  // to cover them (the max rule), and the cited ids join the context.
  const cited = [...new Set(changes.flatMap((c) => extractCitations(String(c.to)).map((m) => m.id)))];
  const contextIds = [...old.contextIds];
  const labels = [old.label];
  for (const id of cited) {
    const item = await showItem(ctx, by, id).catch(() => null);
    if (!item) continue;
    labels.push(item.label);
    if (!contextIds.includes(id)) contextIds.push(id);
  }
  const label = maxLabel(labels);
  const raised = LABELS.indexOf(label) > LABELS.indexOf(old.label);
  return successor(ctx, old, { edits, contextIds, ...(raised ? { label, ...(label === 'personal' && !old.owner ? { owner: by } : {}) } : {}) });
}

export async function recordDecision(ctx, proposalId, { decision, by, note }) {
  const old = await pendingTrace(ctx, proposalId);
  if (!old) return null;
  return successor(ctx, old, {
    decision,
    decisionId: decision === 'approved' ? proposalId : null,
    decidedBy: by,
    decidedAt: new Date().toISOString(),
    decisionNote: optionalString(note) ? clip(note, 500) : null,
  });
}

// ---- reads ----------------------------------------------------------------------

function visible(ctx, principal, row) {
  if (typeof principal !== 'string' || !Object.hasOwn(ctx.policy.principals, principal)) return false;
  if (!canRead(ctx.policy, principal, row.label, row.owner)) return false;
  return row.decision !== 'pending' || isFounderPrincipal(principal, ctx.policy) || row.proposedBy === principal;
}

// What a reader may see of a trace. A `test` triage points at a holdout case, so
// non-founders get the class only (no case id, no note: the id is a hash of the
// case and would confirm a guess offline). A suggestion's note is free text a
// non-founder wrote at the trace label: only founders and its author see it.
function view(ctx, principal, row) {
  const founder = isFounderPrincipal(principal, ctx.policy);
  const triage = !row.triage || founder || row.triage.class !== 'test' ? row.triage : { class: row.triage.class, by: row.triage.by, at: row.triage.at };
  const suggestions = row.suggestions.map((entry) => (founder || entry.by === principal ? entry : { class: entry.class, by: entry.by, at: entry.at }));
  return {
    id: row.id,
    label: row.label,
    subject: row.subject,
    proposalId: row.proposalId,
    proposedBy: row.proposedBy,
    contextIds: row.contextIds,
    edits: row.edits,
    decision: row.decision,
    decisionId: row.decisionId,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    outcome: row.outcome,
    triage,
    suggestions,
    created: row.eventAt,
    updated: row.validFrom,
    isCorrection: isCorrection(row),
  };
}

// A correction is a proposal a founder rejected or changed before approving.
export function isCorrection(row) {
  return row.decision === 'rejected' || row.edits.length > 0;
}

export async function listTraces(ctx, principal, options = {}) {
  requiredString(principal, 'principal');
  const rows = (await ctx.store.liveRecords(KIND)).filter((row) => visible(ctx, principal, row));
  const chosen = options.untriaged ? rows.filter((row) => isCorrection(row) && !row.triage) : rows;
  return { principal, count: chosen.length, traces: chosen.map((row) => view(ctx, principal, row)) };
}

const round = (row) => Number(row.dedupeKey.split(':').pop());
// A proposal id names its rounds oldest first; by proposal id the newest round wins.
const byRound = (a, b) => round(a) - round(b);

// Accepts a trace id (any version) or the proposal id. An unreadable trace is
// indistinguishable from a missing one.
async function findLive(ctx, principal, id) {
  const wanted = requiredString(id, 'id');
  const all = await ctx.store.listRecords(KIND);
  const hit = all.find((row) => row.id === wanted);
  const live = hit
    ? all.find((row) => row.dedupeKey === hit.dedupeKey && !row.validTo && !row.supersededById)
    : (await ctx.store.liveRecords(KIND)).filter((row) => row.proposalId === wanted).sort(byRound).pop();
  if (!live || !visible(ctx, principal, live)) throw new Error(`no trace: ${wanted}`);
  return live;
}

export async function showTrace(ctx, principal, id) {
  const live = await findLive(ctx, principal, id);
  const history = (await ctx.store.listRecords(KIND)).filter((row) => row.dedupeKey === live.dedupeKey).length;
  return { ...view(ctx, principal, live), versions: history };
}

// ---- writes ---------------------------------------------------------------------

function requireFounder(ctx, principal, what) {
  if (!isFounderPrincipal(principal, ctx.policy)) throw new Error(`only a founder ${what}`);
}

export function recordOutcome(ctx, principal, id, text) {
  return serializeByDataDir(ctx.dataDir, async () => {
    requireFounder(ctx, principal, 'records an outcome');
    const old = await findLive(ctx, principal, id);
    const outcome = clip(requiredString(text, 'outcome'), 2000);
    return view(ctx, principal, await successor(ctx, old, { outcome }));
  });
}

// Anyone with a grant who can read the trace may suggest a class. A suggestion
// is a note on the trace; it never sets `triage`, never triggers an effect.
export function suggestTriage(ctx, principal, id, cls, note) {
  return serializeByDataDir(ctx.dataDir, async () => {
    if (!TRIAGE_CLASSES.includes(cls)) throw new Error(`class must be one of: ${TRIAGE_CLASSES.join(', ')}`);
    const old = await findLive(ctx, principal, id);
    if (old.suggestions.some((entry) => entry.by === principal && entry.class === cls)) return view(ctx, principal, old);
    const suggestions = [...old.suggestions, { class: cls, by: principal, at: new Date().toISOString(), note: optionalString(note) ? clip(note, 500) : null }];
    return view(ctx, principal, await successor(ctx, old, { suggestions }));
  });
}

// locked. Sets the founder's class once. Effects (holdout case, system
// proposal) happen in triage.mjs before this is called.
export async function setTriage(ctx, principal, id, triage) {
  const old = await findLive(ctx, principal, id);
  if (old.triage) throw new Error(`${old.id} is already triaged as ${old.triage.class}`);
  return view(ctx, principal, await successor(ctx, old, { triage: { ...triage, by: principal, at: new Date().toISOString() } }));
}

export { findLive, requireFounder };
