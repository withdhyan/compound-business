import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { propose, reject } from './curation.mjs';
import { buildPolicy } from './policy.mjs';
import { createCompanyStore, serializeByDataDir } from './store.mjs';
import { holdoutFile } from './triage.mjs';

const RULES = 'mem_aaaaaaaaaaaaaaaa';
const policy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', scribe: 'team', teammate: 'team' },
});

async function corpus(n) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-lock-'));
  await fs.mkdir(path.join(dataDir, 'memory'), { recursive: true });
  await fs.writeFile(path.join(dataDir, 'memory', 'rules.md'), `---\nid: ${RULES}\nlabel: team\ntitle: Rules\n---\nx\n`);
  const ctx = { store: createCompanyStore({ dataDir, policy }), policy, dataDir, memoryDirs: [path.join(dataDir, 'memory')] };
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const row = await propose(ctx, 'scribe', { label: 'team', title: `T${i}`, quote: `q${i}`, source: 's' });
    await reject(ctx, 'founder', [row.id], { note: 'no' });
    ids.push(row.id);
  }
  return { dataDir, ctx, ids };
}

const worker = fileURLToPathOf('./lock-worker.mjs');
function fileURLToPathOf(rel) {
  return new URL(rel, import.meta.url).pathname;
}
const run = (role, dataDir, ids) => new Promise((resolve) => {
  const child = spawn(process.execPath, [worker, role, dataDir, ids.join(',')]);
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  child.on('close', () => resolve(out.trim()));
});

async function liveByKey(ctx) {
  const live = (await ctx.store.listRecords('BusinessTrace')).filter((r) => !r.validTo && !r.supersededById);
  const by = new Map();
  for (const r of live) by.set(r.dedupeKey, [...(by.get(r.dedupeKey) ?? []), r]);
  return { live, by };
}

test('two founder processes triaging the same corrections: one live trace each, no orphan holdout line', async () => {
  const { dataDir, ctx, ids } = await corpus(12);
  await Promise.all([run('exception', dataDir, ids), run('test', dataDir, ids)]);
  const { live, by } = await liveByKey(ctx);
  assert.equal([...by.values()].filter((v) => v.length > 1).length, 0, 'duplicate live traces');
  assert.equal(by.size, 12);
  const lines = (await fs.readFile(holdoutFile(ctx), 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const owned = new Set(live.map((r) => r.triage?.caseId).filter(Boolean));
  assert.equal(lines.filter((l) => !owned.has(l.id)).length, 0, 'orphan holdout lines');
  assert.ok(live.every((r) => r.triage), 'every correction was triaged by one of them');
});

test('an agent process suggesting while a founder process triages: no duplicate live traces', async () => {
  const { dataDir, ctx, ids } = await corpus(12);
  await Promise.all([run('agent', dataDir, ids), run('exception', dataDir, ids)]);
  const { by } = await liveByKey(ctx);
  assert.equal([...by.values()].filter((v) => v.length > 1).length, 0);
  assert.equal(by.size, 12);
});

test('two processes proposing at once leave every pending file whole', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-lock-'));
  const ids = Array.from({ length: 20 }, (_, i) => `n${i}`);
  await Promise.all([run('propose', dataDir, ids), run('propose', dataDir, ids)]);
  const ctx = { store: createCompanyStore({ dataDir, policy }), policy, dataDir, memoryDirs: [] };
  const pending = (await fs.readdir(path.join(dataDir, 'pending'))).filter((n) => n.endsWith('.json'));
  assert.equal(pending.length, 20);
  for (const name of pending) JSON.parse(await fs.readFile(path.join(dataDir, 'pending', name), 'utf8'));
  const { by } = await liveByKey(ctx);
  assert.equal(by.size, 20);
  assert.deepEqual((await fs.readdir(dataDir)).filter((n) => n.includes('.cb.lock')), [], 'the lock is released');
});

test('a lock left by a dead process is broken; a live holder is waited for', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-lock-'));
  await fs.writeFile(path.join(dataDir, '.cb.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, token: 'dead', at: Date.now() }));
  assert.equal(await serializeByDataDir(dataDir, async () => 'ran'), 'ran');
  // a live holder (this process) blocks a second writer until it lets go
  let release;
  const held = serializeByDataDir(dataDir, () => new Promise((resolve) => { release = resolve; }));
  while (!release) await new Promise((r) => setTimeout(r, 5));
  const child = run('propose', dataDir, ['w1']);
  await new Promise((r) => setTimeout(r, 300));
  await assert.rejects(fs.readdir(path.join(dataDir, 'pending')), /ENOENT/, 'the child is still waiting');
  release();
  await held;
  assert.match(await child, /"ok":1/);
  assert.equal((await fs.readdir(path.join(dataDir, 'pending'))).filter((n) => n.endsWith('.json')).length, 1);
});
