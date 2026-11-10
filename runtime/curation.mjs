import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { optionalString, requiredString } from './kernel.mjs';
import { citeCheck, extractCitations, showItem } from './memory.mjs';
import { LABELS, canRead, isFounderPrincipal, normalizeLabel } from './policy.mjs';
import { serializeByDataDir } from './store.mjs';
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

export function propose(ctx, principal, input) {
  return serializeByDataDir(ctx.dataDir, () => proposeLocked(ctx, principal, input));
}

async function proposeLocked(ctx, principal, input) {
  const who = requiredString(principal, 'principal');
  const label = normalizeLabel(input?.label);
  const owner = optionalString(input?.owner) ?? (label === 'personal' ? who : undefined);
  if (!Object.hasOwn(ctx.policy.principals, who) || !canRead(ctx.policy, who, label, owner)) {
    throw new Error(`${who} cannot propose a ${label} item`);
  }
  const trust = optionalString(input?.trust) ?? 'trusted';
  if (!TRUST.includes(trust)) throw new Error(`invalid trust: ${trust}`);
  // Content from an untrusted source (inbound mail, a web page, a partner's
  // text) is promoted only after a founder has read it and says so. The flag
  // is honoured only from a founder principal; an agent cannot assert it.
  if (trust === 'untrusted' && !(input.founderApproved === true && isFounderPrincipal(who, ctx.policy))) {
    throw new Error('untrusted source needs a founder to propose it with founderApproved');
  }
  const evidence = await checkEvidence(ctx, who, input.evidence);
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
    ...(trust === 'untrusted' ? { trust, founderApproved: true } : {}),
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
      } else {
        throw new Error('a pending edit already targets this item');
      }
    }
  }
  const pending = { id, status: 'pending', ...entry, proposedBy: who, proposedAt: new Date().toISOString() };
  const dir = pendingDir(ctx);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(pendingFile(ctx, id), `${JSON.stringify(pending, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return JSON.parse(await fs.readFile(pendingFile(ctx, id), 'utf8'));
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
    for (const row of chosen) await fs.rm(pendingFile(ctx, row.id), { force: true });
    return { rejected: chosen.map((row) => row.id) };
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
      trust: row.trust ?? 'trusted',
      supersedes: row.supersedes ?? null,
      proposedBy: row.proposedBy,
      proposerGrant: grant ?? null,
      writeDown,
    });
  }
  return { principal, count: rows.length, rows };
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
