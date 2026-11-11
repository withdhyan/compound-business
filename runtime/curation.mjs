import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { optionalString, requiredString } from './kernel.mjs';
import { citeCheck, extractCitations, showItem } from './memory.mjs';
import { LABELS, canRead, isFounderPrincipal, normalizeLabel } from './policy.mjs';
import { serializeByDataDir, writeFileAtomic } from './store.mjs';
import { listTraces, openTrace, recordDecision, recordEdits, traceContext } from './trace.mjs';
import { safeDataPath } from './safe-path.mjs';

// The curation queue (plan KD6/R10). An agent drafts; a founder approves.
// Pending entries live in <dataDir>/pending/, a path no reader scans, so they
// are invisible to get/index/show by construction. Approval writes a
// markdown file under <memory>/approved/ whose frontmatter carries the label,
// source, proposer, approver and date; the pending id becomes the citation id.
const ID = /^mem_[0-9a-f]{16}$/;
const TRUST = ['trusted', 'untrusted'];
const MAX_EVIDENCE = 10;
// A pending entry nobody approved within this many days is stale: it no longer
// blocks edits, shows in the digest, or can be approved. `reject --stale` purges.
export const PENDING_TTL_DAYS = 30;

// options.untrustedLaunch: the proposing agent was launched as an untrusted
// reader (`cb mcp --untrusted`); everything it proposes is stamped untrusted
// and still needs a founder's approval.
export function propose(ctx, principal, input, options = {}) {
  return serializeByDataDir(ctx.dataDir, () => proposeLocked(ctx, principal, input, options));
}

// Exported for callers already inside the per-dataDir critical section.
export async function proposeLocked(ctx, principal, input, options) {
  const who = requiredString(principal, 'principal');
  const label = normalizeLabel(input?.label);
  const owner = optionalString(input?.owner) ?? (label === 'personal' ? who : undefined);
  if (!Object.hasOwn(ctx.policy.principals, who) || !canRead(ctx.policy, who, label, owner)) {
    throw new Error(`${who} cannot propose a ${label} item`);
  }
  const trust = options.untrustedLaunch ? 'untrusted' : optionalString(input?.trust) ?? 'trusted';
  if (!TRUST.includes(trust)) throw new Error(`invalid trust: ${trust}`);
  // Content from an untrusted source (inbound mail, a web page, a partner's
  // text) is promoted only after a founder has read it and says so. The flag
  // is honoured only from a founder principal; an agent cannot assert it.
  if (trust === 'untrusted' && !options.untrustedLaunch && !(input.founderApproved === true && isFounderPrincipal(who, ctx.policy))) {
    throw new Error('untrusted source needs a founder to propose it with founderApproved');
  }
  const evidence = await checkEvidence(ctx, who, input.evidence);
  const aliases = cleanAliases(input.aliases);
  const supersedes = optionalString(input?.supersedes);
  if (supersedes) await checkTarget(ctx, who, supersedes, label);
  const entry = {
    label,
    title: oneLine(requiredString(input.title, 'title')),
    quote: requiredString(input.quote, 'quote'),
    source: oneLine(requiredString(input.source, 'source')),
    ...(owner ? { owner: oneLine(owner) } : {}),
    ...(optionalString(input.summary) ? { summary: oneLine(input.summary) } : {}),
    ...(optionalString(input.body) ? { body: String(input.body).trim() } : {}),
    ...(supersedes ? { supersedes } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(trust === 'untrusted' ? { trust, ...(options.untrustedLaunch ? {} : { founderApproved: true }) } : {}),
    ...(aliases.length ? { aliases } : {}),
  };
  const id = `mem_${createHash('sha256')
    .update(JSON.stringify([who, entry.label, entry.title, entry.quote, entry.source, ...(supersedes ? [supersedes] : [])]))
    .digest('hex')
    .slice(0, 16)}`;
  if (supersedes) {
    const rival = (await allPending(ctx)).find((row) => !row.stale && row.supersedes === supersedes && row.id !== id);
    if (rival) {
      // A founder's edit displaces a non-founder's pending edit of the same
      // item; anyone else is told only that an edit is already waiting.
      if (isFounderPrincipal(who, ctx.policy) && !isFounderPrincipal(rival.proposedBy, ctx.policy)) {
        await fs.rm(pendingFile(ctx, rival.id), { force: true });
        // The displaced proposal is a correction: close its trace.
        await recordDecision(ctx, rival.id, { decision: 'rejected', by: who, note: `displaced by a founder's edit ${id}` });
      } else {
        throw new Error('a pending edit already targets this item');
      }
    }
  }
  const pending = { id, status: 'pending', ...entry, proposedBy: who, proposedAt: new Date().toISOString() };
  const dir = pendingDir(ctx);
  await fs.mkdir(dir, { recursive: true });
  try {
    await writeFileAtomic(pendingFile(ctx, id), `${JSON.stringify(pending, null, 2)}\n`, { exclusive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return JSON.parse(await fs.readFile(pendingFile(ctx, id), 'utf8'));
  }
  // The trace opens with the proposal. If it cannot be written the proposal is
  // withdrawn, so a pending entry never lacks its trace.
  try {
    const context = await traceContext(ctx, who, label, { supersedes, evidence });
    await openTrace(ctx, { proposalId: id, subject: entry.title, proposedBy: who, ...context });
  } catch (error) {
    await fs.rm(pendingFile(ctx, id), { force: true });
    throw error;
  }
  return pending;
}

export async function listPending(ctx, principal) {
  requireFounder(ctx, principal);
  return (await allPending(ctx)).filter((row) => !row.stale && canRead(ctx.policy, principal, row.label, row.owner));
}

async function allPending(ctx) {
  let names;
  try {
    names = await fs.readdir(pendingDir(ctx));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const name of names.filter((entry) => entry.endsWith('.json')).sort()) {
    const row = JSON.parse(await fs.readFile(path.join(pendingDir(ctx), name), 'utf8'));
    const ageDays = (Date.now() - Date.parse(row.proposedAt)) / 86_400_000;
    rows.push({ ...row, stale: ageDays > (ctx.pendingTtlDays ?? PENDING_TTL_DAYS) });
  }
  return rows;
}

// Founders drop pending entries they will not approve (or, with `stale`, every
// entry past the TTL they can read). Nothing becomes live.
export function reject(ctx, principal, ids, options = {}) {
  return serializeByDataDir(ctx.dataDir, async () => {
    requireFounder(ctx, principal);
    const mine = (await allPending(ctx)).filter((row) => canRead(ctx.policy, principal, row.label, row.owner));
    const chosen = options.stale ? mine.filter((row) => row.stale) : mine.filter((row) => ids.includes(row.id));
    if (!options.stale) {
      for (const id of ids) if (!chosen.some((row) => row.id === id)) throw new Error(`no pending entry: ${id}`);
    }
    for (const row of chosen) {
      await fs.rm(pendingFile(ctx, row.id), { force: true });
      await recordDecision(ctx, row.id, { decision: 'rejected', by: principal, note: options.note });
    }
    return { rejected: chosen.map((row) => row.id) };
  });
}

// A founder changes a pending proposal before approving it. Each changed field
// is appended to the trace (what it said, what it says now): the correction is
// kept as context, not applied as a rule.
const EDITABLE = ['title', 'summary', 'body', 'aliases'];
export function editPending(ctx, principal, id, fields) {
  return serializeByDataDir(ctx.dataDir, async () => {
    requireFounder(ctx, principal);
    const row = (await listPending(ctx, principal)).find((entry) => entry.id === id);
    if (!row) throw new Error(`no pending entry: ${id}`);
    const next = { ...row };
    delete next.stale;
    const changes = [];
    for (const field of EDITABLE) {
      if (fields?.[field] === undefined || fields[field] === true) continue;
      const value = field === 'aliases' ? cleanAliases(fields[field]) : field === 'body' ? String(fields[field]).trim() : oneLine(requiredString(fields[field], field));
      const before = field === 'aliases' ? (row.aliases ?? []) : row[field] ?? '';
      if (JSON.stringify(before) === JSON.stringify(value)) continue;
      changes.push({ field, from: Array.isArray(before) ? before.join(', ') : before, to: Array.isArray(value) ? value.join(', ') : value });
      if (Array.isArray(value) ? value.length : value) next[field] = value;
      else delete next[field];
    }
    if (changes.length === 0) throw new Error(`nothing to edit (editable: ${EDITABLE.join(', ')})`);
    await writeFileAtomic(pendingFile(ctx, id), `${JSON.stringify(next, null, 2)}\n`);
    await recordEdits(ctx, id, principal, changes);
    return { edited: id, fields: changes.map((change) => change.field) };
  });
}

// The pending queue as one batch for the founder. Every field `approve` will
// write is shown in full: what the founder sees is what becomes live. A row
// whose proposer holds a higher grant than the row's label is a WRITE-DOWN
// (content may have been lifted from a more private tier).
export async function digest(ctx, principal) {
  const rows = [];
  for (const row of await listPending(ctx, principal)) {
    let change = `new: ${row.title}`;
    if (row.supersedes) {
      const target = await showItem(ctx, principal, row.supersedes).catch(() => null);
      change = `replaces ${row.supersedes}${target ? ` "${target.title}"` : ''} with: ${row.title}`;
    }
    const grant = ctx.policy.principals[row.proposedBy];
    const writeDown = !isFounderPrincipal(row.proposedBy, ctx.policy) && LABELS.indexOf(grant) > LABELS.indexOf(row.label);
    rows.push({
      id: row.id,
      label: row.label,
      source: row.source,
      title: row.title,
      summary: row.summary ?? null,
      owner: row.owner ?? null,
      quote: row.quote,
      body: row.body ?? null,
      change: row.body ? `${change} -- ${row.body}` : change,
      evidence: row.evidence ?? [],
      aliases: row.aliases ?? [],
      trust: row.trust ?? 'trusted',
      supersedes: row.supersedes ?? null,
      proposedBy: row.proposedBy,
      proposerGrant: grant ?? null,
      writeDown,
    });
  }
  // Corrections nobody has classified yet: what was rejected or changed, and
  // the three things it can become. Traces the founder cannot read are absent.
  const untriaged = (await listTraces(ctx, principal, { untriaged: true })).traces.map((trace) => ({
    id: trace.id,
    label: trace.label,
    subject: trace.subject,
    how: trace.decision === 'rejected' ? 'rejected' : `edited ${trace.edits.length}x, ${trace.decision}`,
    by: trace.decidedBy,
    note: trace.decisionNote,
    edits: trace.edits.map((edit) => `${edit.field}: "${edit.from}" -> "${edit.to}"`),
    suggestions: trace.suggestions.map((entry) => ({ class: entry.class, by: entry.by })),
    choices: ['exception', 'test', 'system'],
  }));
  return { principal, count: rows.length, rows, untriagedCount: untriaged.length, untriaged };
}

// Alternative words for finding an item (indexed like the title). Short,
// one-line terms; the digest shows them to the founder.
function cleanAliases(value) {
  if (value === undefined || value === null || value === true) return [];
  const list = (Array.isArray(value) ? value : String(value).split(','))
    .map((entry) => oneLine(String(entry)))
    .filter(Boolean);
  if (list.length > 20 || list.some((entry) => entry.length > 60)) throw new Error('aliases: at most 20 terms of 60 characters');
  return [...new Set(list)];
}

async function checkEvidence(ctx, who, value) {
  if (value === undefined || value === null) return [];
  const list = (Array.isArray(value) ? value : [value]).map((entry) => oneLine(requiredString(entry, 'evidence')));
  if (list.length > MAX_EVIDENCE) throw new Error(`at most ${MAX_EVIDENCE} evidence entries`);
  const report = await citeCheck(ctx, who, list.join('\n'));
  const missing = report.citations.find((entry) => entry.status === 'missing');
  if (missing) throw new Error(`evidence cites a missing item: ${missing.id}`);
  return list;
}

// A superseding edit names a live file item the proposer can read, at the
// same label (a label never changes across supersession).
async function checkTarget(ctx, who, id, label) {
  if (!ID.test(id)) throw new Error(`invalid supersedes: ${id}`);
  const target = await showItem(ctx, who, id);
  if (target.source !== 'file') throw new Error('only a memory file can be superseded by an edit');
  if (target.superseded) throw new Error(`${id} is already superseded`);
  if (target.label !== label) throw new Error('a successor cannot change label');
}

export function approve(ctx, principal, ids) {
  return serializeByDataDir(ctx.dataDir, () => approveLocked(ctx, principal, ids));
}

async function approveLocked(ctx, principal, ids) {
  requireFounder(ctx, principal);
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) throw new Error('approve needs at least one id');
  const visible = new Map((await listPending(ctx, principal)).map((row) => [row.id, row]));
  // All-or-nothing: validate every id before the first write.
  for (const id of wanted) {
    if (!ID.test(id) || !visible.has(id)) throw new Error(`no pending entry: ${id}`);
  }
  const claimed = new Set();
  for (const id of wanted) {
    const edit = visible.get(id);
    if (!edit.supersedes) continue;
    if (claimed.has(edit.supersedes)) throw new Error(`two pending entries target ${edit.supersedes}`);
    claimed.add(edit.supersedes);
    await checkTarget(ctx, principal, edit.supersedes, edit.label);
  }
  const root = path.resolve(ctx.memoryDirs[0]);
  const target = safeDataPath(root, 'approved');
  const existing = await fs.lstat(target).catch(() => null);
  if (existing && !existing.isDirectory()) throw new Error('memory/approved must be a real directory');
  await fs.mkdir(target, { recursive: true });
  const at = new Date().toISOString();
  for (const id of wanted) {
    const row = visible.get(id);
    const file = safeDataPath(root, `approved/${id}.md`);
    try {
      const shown = { ...row, ...(row.evidence ? { evidence: await redactEvidence(ctx, principal, row) } : {}) };
      await fs.writeFile(file, render(shown, principal, at), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    await fs.rm(pendingFile(ctx, id));
    await recordDecision(ctx, id, { decision: 'approved', by: principal });
  }
  return { approved: wanted };
}

// An approved item is read at its own label. Evidence ids that point at items
// above that label (or that the approver cannot resolve) would prove a hidden
// item exists, so they are written as a placeholder.
async function redactEvidence(ctx, principal, row) {
  const out = [];
  for (const line of row.evidence) {
    let text = line;
    for (const { id } of extractCitations(line)) {
      const item = await showItem(ctx, principal, id).catch(() => null);
      if (!item || LABELS.indexOf(item.label) > LABELS.indexOf(row.label)) text = text.split(id).join('[restricted item]');
    }
    out.push(text);
  }
  return out;
}

function render(row, approver, at) {
  const lines = [
    '---',
    `id: ${row.id}`,
    `label: ${row.label}`,
    `title: ${row.title}`,
    ...(row.summary ? [`summary: ${oneLine(row.summary)}`] : []),
    ...(row.owner ? [`owner: ${row.owner}`] : []),
    ...(row.supersedes ? [`supersedes: ${row.supersedes}`] : []),
    ...(row.trust ? [`trust: ${row.trust}`] : []),
    ...(row.aliases?.length ? [`aliases: ${row.aliases.map(oneLine).join(', ')}`] : []),
    `updated: ${at.slice(0, 10)}`,
    `source: ${row.source}`,
    `proposed-by: ${row.proposedBy}`,
    `approved-by: ${approver}`,
    `approved-at: ${at}`,
    '---',
    `# ${row.title}`,
    '',
    ...(row.body ? [row.body, ''] : []),
    ...row.quote.split(/\r?\n/).map((line) => `> ${line}`),
    '',
    `Source: ${row.source}`,
    '',
    ...(row.evidence ? ['Evidence:', ...row.evidence.map((line) => `- ${line}`), ''] : []),
  ];
  return lines.join('\n');
}

function requireFounder(ctx, principal) {
  if (!isFounderPrincipal(principal, ctx.policy)) throw new Error('only a founder approves or lists pending entries');
}

function pendingDir(ctx) {
  return safeDataPath(requiredString(ctx.dataDir, 'dataDir'), 'pending');
}

function pendingFile(ctx, id) {
  if (!ID.test(id)) throw new Error(`invalid pending id: ${id}`);
  return safeDataPath(ctx.dataDir, path.join('pending', `${id}.json`));
}

function clipText(value, max) {
  const text = oneLine(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}
