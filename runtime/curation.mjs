import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { optionalString, requiredString } from './kernel.mjs';
import { canRead, isFounderPrincipal, normalizeLabel } from './policy.mjs';
import { safeDataPath } from './safe-path.mjs';

// The curation queue (plan KD6/R10). An agent drafts; a founder approves.
// Pending entries live in <dataDir>/pending/, a path no reader scans, so they
// are invisible to get/index/show by construction. Approval writes a
// markdown file under <memory>/approved/ whose frontmatter carries the label,
// source, proposer, approver and date; the pending id becomes the citation id.
const ID = /^mem_[0-9a-f]{16}$/;

export async function propose(ctx, principal, input) {
  const who = requiredString(principal, 'principal');
  const label = normalizeLabel(input?.label);
  const owner = optionalString(input?.owner) ?? (label === 'personal' ? who : undefined);
  if (!Object.hasOwn(ctx.policy.principals, who) || !canRead(ctx.policy, who, label, owner)) {
    throw new Error(`${who} cannot propose a ${label} item`);
  }
  const entry = {
    label,
    title: oneLine(requiredString(input.title, 'title')),
    quote: requiredString(input.quote, 'quote'),
    source: oneLine(requiredString(input.source, 'source')),
    ...(owner ? { owner: oneLine(owner) } : {}),
    ...(optionalString(input.summary) ? { summary: oneLine(input.summary) } : {}),
  };
  const id = `mem_${createHash('sha256')
    .update(JSON.stringify([who, entry.label, entry.title, entry.quote, entry.source]))
    .digest('hex')
    .slice(0, 16)}`;
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
    if (canRead(ctx.policy, principal, row.label, row.owner)) rows.push(row);
  }
  return rows;
}

export async function approve(ctx, principal, ids) {
  requireFounder(ctx, principal);
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) throw new Error('approve needs at least one id');
  const visible = new Map((await listPending(ctx, principal)).map((row) => [row.id, row]));
  // All-or-nothing: validate every id before the first write.
  for (const id of wanted) {
    if (!ID.test(id) || !visible.has(id)) throw new Error(`no pending entry: ${id}`);
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
      await fs.writeFile(file, render(row, principal, at), { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    await fs.rm(pendingFile(ctx, id));
  }
  return { approved: wanted };
}

function render(row, approver, at) {
  const lines = [
    '---',
    `id: ${row.id}`,
    `label: ${row.label}`,
    `title: ${row.title}`,
    ...(row.summary ? [`summary: ${row.summary}`] : []),
    ...(row.owner ? [`owner: ${row.owner}`] : []),
    `updated: ${at.slice(0, 10)}`,
    `source: ${row.source}`,
    `proposed-by: ${row.proposedBy}`,
    `approved-by: ${approver}`,
    `approved-at: ${at}`,
    '---',
    `# ${row.title}`,
    '',
    ...row.quote.split(/\r?\n/).map((line) => `> ${line}`),
    '',
    `Source: ${row.source}`,
    '',
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

function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}
