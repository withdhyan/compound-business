import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { approve, listPending, propose } from './curation.mjs';
import { getItems, showItem } from './memory.mjs';
import { buildPolicy } from './policy.mjs';
import { createCompanyStore } from './store.mjs';

const policy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', 'guest-artist': 'team', scribe: 'team' },
  externals: { artist: [] },
});

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-curation-'));
  const memory = path.join(dataDir, 'memory');
  const store = createCompanyStore({ dataDir, policy });
  return { dataDir, memory, ctx: { store, policy, dataDir, memoryDirs: [memory] } };
}

const entry = (overrides = {}) => ({
  label: 'team',
  title: 'Never discount in week one',
  quote: 'we never discount before a signed LOI',
  source: 'thread 2026-11-09',
  ...overrides,
});

test('a proposal is pending and invisible to every reader', async () => {
  const { ctx } = await setup();
  const pending = await propose(ctx, 'scribe', entry());
  assert.match(pending.id, /^mem_[0-9a-f]{16}$/);
  assert.equal(pending.status, 'pending');
  for (const who of ['founder', 'cofounder', 'guest-artist', 'scribe']) {
    assert.deepEqual((await getItems(ctx, who, 'discount')).results, [], who);
    await assert.rejects(() => showItem(ctx, who, pending.id), /no item/);
  }
});

test('approving makes the entry live under its proposal id, with provenance', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  const done = await approve(ctx, 'cofounder', [id]);
  assert.deepEqual(done.approved, [id]);
  const { results } = await getItems(ctx, 'guest-artist', 'discount');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, id);
  const shown = await showItem(ctx, 'guest-artist', id);
  assert.match(shown.body, /> we never discount before a signed LOI/);
  assert.match(shown.body, /thread 2026-11-09/);
  assert.deepEqual((await listPending(ctx, 'cofounder')), []);
  // approval is recorded on the file itself
  const text = await fs.readFile(path.join(ctx.memoryDirs[0], 'approved', `${id}.md`), 'utf8');
  assert.match(text, /approved-by: cofounder/);
  assert.match(text, /proposed-by: scribe/);
});

test('only a founder who can read the label may approve; unknown ids change nothing', async () => {
  const { ctx } = await setup();
  const a = await propose(ctx, 'scribe', entry());
  const b = await propose(ctx, 'cofounder', entry({ label: 'personal', title: 'Mine', owner: 'cofounder', quote: 'q2' }));
  await assert.rejects(() => approve(ctx, 'guest-artist', [a.id]), /only a founder approves/);
  await assert.rejects(() => approve(ctx, 'artist', [a.id]), /only a founder approves/);
  await assert.rejects(() => approve(ctx, 'founder', [b.id]), /no pending entry/);
  await assert.rejects(() => approve(ctx, 'cofounder', [a.id, 'mem_0000000000000000']), /no pending entry/);
  assert.equal((await listPending(ctx, 'cofounder')).length, 2);
  assert.deepEqual((await getItems(ctx, 'guest-artist', 'discount')).results, []);
});

test('a proposer cannot propose above their own grant, and externals cannot propose', async () => {
  const { ctx } = await setup();
  await assert.rejects(() => propose(ctx, 'scribe', entry({ label: 'founders' })), /cannot propose a founders item/);
  await assert.rejects(() => propose(ctx, 'artist', entry({ label: 'public' })), /cannot propose/);
  await assert.rejects(() => propose(ctx, 'stranger', entry({ label: 'public' })), /cannot propose/);
  await assert.rejects(() => propose(ctx, 'scribe', entry({ label: undefined })), /label is required/);
  await assert.rejects(() => propose(ctx, 'scribe', entry({ quote: '' })), /quote is required/);
});

test('pending is listed to founders only, with label, source and quote', async () => {
  const { ctx } = await setup();
  await propose(ctx, 'scribe', entry());
  await assert.rejects(() => listPending(ctx, 'guest-artist'), /only a founder/);
  const [row] = await listPending(ctx, 'cofounder');
  assert.equal(row.label, 'team');
  assert.equal(row.source, 'thread 2026-11-09');
  assert.equal(row.quote, 'we never discount before a signed LOI');
});

test('values cannot forge frontmatter and a repeat approve is harmless', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry({ title: 'x\nlabel: public', quote: 'a\n---\nlabel: public' }));
  await approve(ctx, 'cofounder', [id]);
  const shown = await showItem(ctx, 'guest-artist', id);
  assert.equal(shown.label, 'team');
  await assert.rejects(() => approve(ctx, 'cofounder', [id]), /no pending entry/);
  assert.equal((await getItems(ctx, 'guest-artist', 'label')).results.length, 1);
});

test('proposing the same entry twice keeps one pending entry', async () => {
  const { ctx } = await setup();
  const one = await propose(ctx, 'scribe', entry());
  const two = await propose(ctx, 'scribe', entry());
  assert.equal(one.id, two.id);
  assert.equal((await listPending(ctx, 'cofounder')).length, 1);
});
