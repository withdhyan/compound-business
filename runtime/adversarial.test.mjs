// Adversarial probes for 9dc1830. Each test asserts the SECURE behaviour, so a
// failing test is a demonstrated break; a passing test is a held boundary.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildContext } from './cli.mjs';
import { approve, propose } from './curation.mjs';
import { authorizeStoredAction } from './ladder.mjs';
import { handleMessage } from './mcp.mjs';
import { buildIndex, citeCheck, getItems, showItem } from './memory.mjs';
import { buildPolicy } from './policy.mjs';
import { buildAuthorityGrant } from './records.mjs';
import { createCompanyStore } from './store.mjs';

const base = {
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', 'guest-artist': 'team', bot: 'public' },
  externals: { artist: ['memory/kit.md'] },
};
const policy = buildPolicy(base);

async function setup(files = {}, pol = policy, extraDirs = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-adv-'));
  const write = async (dir, map) => {
    for (const [name, body] of Object.entries(map)) {
      const file = path.join(dir, name);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, body);
    }
  };
  const memory = path.join(root, 'memory');
  await fs.mkdir(memory, { recursive: true });
  await write(memory, files);
  const dirs = [memory];
  for (const [dir, map] of Object.entries(extraDirs)) {
    const abs = path.join(root, dir);
    await fs.mkdir(abs, { recursive: true });
    await write(abs, map);
    dirs.push(abs);
  }
  const store = createCompanyStore({ dataDir: root, policy: pol });
  return { root, memory, store, ctx: { store, memoryDirs: dirs, policy: pol, dataDir: root } };
}
const doc = (fm, title, body = 'pricing residency words') => `---\n${fm}\ntitle: ${title}\n---\n# ${title}\n\n${body}\n`;
const titles = async (ctx, p) => (await buildIndex(ctx, p)).items.map((i) => i.title);

// ---- F1 duplicate frontmatter keys: last wins, lower label leaks ----------------
test('F1 a file with two label keys must not be readable at the lower label', async () => {
  const { ctx } = await setup({ 'board.md': doc('label: founders\nlabel: public', 'Board secret') });
  assert.ok(!(await titles(ctx, 'bot')).includes('Board secret'), 'bot (public) reads a file that also says founders');
});

// ---- F2 personal owner follows founders[0] ----------------------------------------
test('F2 reordering founders must not hand ownerless personal items to another founder', async () => {
  const files = { 'diary.md': doc('label: personal', 'Founder diary') };
  const before = buildPolicy({ founders: ['founder', 'cofounder'], principals: base.principals });
  const after = buildPolicy({ founders: ['cofounder', 'founder'], principals: base.principals });
  const a = await setup(files, before);
  assert.ok(!(await titles(a.ctx, 'cofounder')).includes('Founder diary'));
  const b = await setup(files, after);
  assert.ok(!(await titles(b.ctx, 'cofounder')).includes('Founder diary'), 'cofounder now reads founder\'s diary');
});

// ---- F3 caller-supplied policy overrides store.policy in the wiring gate ---------
test('F3 authorizeStoredAction must ignore a caller-supplied policy', async () => {
  const withBob = buildPolicy({ founders: ['founder', 'bob'], principals: { founder: 'personal', bob: 'founders' } });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-adv-'));
  const at = '2026-09-22T10:00:00.000Z';
  const grant = buildAuthorityGrant({
    role: 'money', scope: 'ap:pay', actionClass: 'reversible', budget: 500,
    expiresAt: '2026-10-22T00:00:00.000Z', grantedBy: 'bob',
  }, () => new Date(at), withBob);
  await createCompanyStore({ dataDir: root, policy: withBob }).writeRecord(grant);
  // bob is removed as a founder: his grants must die.
  const store = createCompanyStore({ dataDir: root, policy: buildPolicy({ founders: ['founder'], principals: { founder: 'personal' } }) });
  const input = { store, grantIds: [grant.id], actionClass: 'reversible', actor: 'money', action: 'pay', scope: 'ap:pay', cost: 10, at: '2026-09-23T00:00:00.000Z' };
  assert.equal((await authorizeStoredAction(input)).allowed, false, 'control: refused under store policy');
  assert.equal((await authorizeStoredAction({ ...input, policy: withBob })).allowed, false, 'caller policy revives an ex-founder grant');
});

// ---- F4 duplicate-id existence oracle ---------------------------------------------
test('F4 a team writer must not learn whether a founders id exists via id collision', async () => {
  const secretId = `mem_${createHash('sha256').update('memory/strategy.md').digest('hex').slice(0, 16)}`;
  const { ctx } = await setup({
    'strategy.md': doc('label: founders', 'Exit plan'),
    'probe.md': doc(`label: team\nid: ${secretId}`, 'guest-artist probe'),
    'probe2.md': doc('label: team\nid: mem_00000000000000aa', 'guest-artist control'),
  });
  const seen = await titles(ctx, 'guest-artist');
  assert.ok(seen.includes('guest-artist control'), 'control visible');
  assert.ok(seen.includes('guest-artist probe'), 'probe vanished => founders item with that id exists');
});

// ---- F5 propose on an existing pending entry returns another proposer's row -----
test('F5 propose must not return another proposer\'s pending row', async () => {
  const pol = buildPolicy({ ...base, principals: { ...base.principals, scribe: 'team' } });
  const { ctx } = await setup({}, pol);
  const e = { label: 'team', title: 't', quote: 'q', source: 's' };
  await propose(ctx, 'scribe', { ...e, summary: 'scribe private note' });
  const mine = await propose(ctx, 'guest-artist', e);
  assert.equal(mine.proposedBy, 'guest-artist', `got proposedBy=${mine.proposedBy}, summary=${mine.summary}`);
});

// ---- F6 external share by path matches every memory dir with the same basename --
test('F6 a path share must lift exactly one file', async () => {
  const { ctx } = await setup(
    { 'kit.md': doc('label: team', 'Brand kit') },
    policy,
    { 'other/memory': { 'kit.md': doc('label: team', 'Other team kit, not shared') } },
  );
  const seen = await titles(ctx, 'artist');
  assert.ok(!seen.includes('Other team kit, not shared'), 'second dir file lifted by the same share entry');
});

// ---- F7 approve writes through a symlinked approved/ dir ---------------------------
test('F7 approve must not write outside the memory root', async () => {
  const { ctx, memory, root } = await setup({});
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-adv-out-'));
  await fs.symlink(outside, path.join(memory, 'approved'));
  const row = await propose(ctx, 'guest-artist', { label: 'team', title: 't', quote: 'q', source: 's' });
  let threw = false;
  try { await approve(ctx, 'founder', [row.id]); } catch { threw = true; }
  const leaked = await fs.readdir(outside);
  assert.ok(threw || leaked.length === 0, `wrote ${leaked} outside ${root}`);
});

// ---- controls: boundaries that should hold ------------------------------------------
test('C1 missing vs forbidden: same show error, same cite-check verdict, same MCP text', async () => {
  const { ctx } = await setup({ 'strategy.md': doc('label: founders\nid: mem_1111111111111111', 'Exit plan') });
  const err = async (id) => showItem(ctx, 'guest-artist', id).then(() => 'ok', (e) => e.message.replace(id, 'X'));
  assert.equal(await err('mem_1111111111111111'), await err('mem_2222222222222222'));
  const cc = await citeCheck(ctx, 'guest-artist', 'mem_1111111111111111 mem_2222222222222222');
  assert.deepEqual(cc.citations.map((c) => c.status), ['missing', 'missing']);
  const call = (id) => handleMessage(ctx, 'guest-artist', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cb_show', arguments: { id } } });
  const [a, b] = [await call('mem_1111111111111111'), await call('mem_2222222222222222')];
  assert.equal(a.result.content[0].text.replace(/mem_\w+/, 'X'), b.result.content[0].text.replace(/mem_\w+/, 'X'));
});

test('C2 superseded-by a hidden item looks like superseded-by nothing', async () => {
  const { ctx } = await setup({
    'old.md': doc('label: team\nsuperseded-by: memory/new.md', 'Old pricing'),
    'new.md': doc('label: founders', 'New secret pricing'),
    'old2.md': doc('label: team\nsuperseded-by: mem_9999999999999999', 'Old2 pricing'),
  });
  const r = (await getItems(ctx, 'guest-artist', 'pricing')).results;
  const strip = ({ id, path: p, title, snippet, ...rest }) => rest;
  assert.deepEqual(strip(r.find((x) => x.title === 'Old pricing')), strip(r.find((x) => x.title === 'Old2 pricing')));
  assert.ok(!JSON.stringify(r).includes('New secret'));
});

test('C3 MCP ignores a principal smuggled in arguments; the only write tool is propose', async () => {
  const { ctx } = await setup({ 'strategy.md': doc('label: founders', 'Exit plan') });
  const res = await handleMessage(ctx, 'bot', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cb_get', arguments: { query: 'exit plan', principal: 'founder', as: 'founder' } } });
  assert.deepEqual(JSON.parse(res.result.content[0].text).results, []);
  const list = await handleMessage(ctx, 'bot', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['cb_cite_check', 'cb_get', 'cb_propose', 'cb_show']);
});

test('C4 approve and pending by a non-founder, external, or team principal are refused', async () => {
  const { ctx } = await setup({});
  const row = await propose(ctx, 'guest-artist', { label: 'team', title: 't', quote: 'q', source: 's' });
  for (const p of ['guest-artist', 'artist', 'bot', 'nobody']) await assert.rejects(approve(ctx, p, [row.id]));
  await assert.rejects(propose(ctx, 'artist', { label: 'public', title: 't', quote: 'q2', source: 's' }));
});

test('C5 policy.json malformed or empty fails closed; missing -> single founder only', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-adv-'));
  const ctx0 = await buildContext({ data: root }, {});
  assert.deepEqual(ctx0.policy.founders, ['founder']);
  assert.equal(await (await buildIndex({ ...ctx0 }, 'guest-artist')).items.length, 0);
  for (const bad of ['', '{', '{}', 'null', '{"founders":["a"],"principals":{"a":"team"}}', '{"founders":["a"],"principals":{"a":"PERSONAL","b":"secret"}}']) {
    await fs.writeFile(path.join(root, 'policy.json'), bad);
    await assert.rejects(buildContext({ data: root }, {}), undefined, bad);
  }
});

test('C6 label case and record label case', async () => {
  const { ctx } = await setup({ 'a.md': doc('label: PUBLIC', 'Upper public'), 'b.md': doc('label: Founders', 'Mixed founders') });
  assert.ok((await titles(ctx, 'bot')).includes('Upper public'));
  assert.ok(!(await titles(ctx, 'bot')).includes('Mixed founders'));
  assert.ok(!(await titles(ctx, 'guest-artist')).includes('Mixed founders'));
});

test('C7 symlinked file and dir inside memory are skipped', async () => {
  const { ctx, memory } = await setup({});
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-adv-out-'));
  await fs.writeFile(path.join(outside, 's.md'), doc('label: public', 'Outside file'));
  await fs.symlink(path.join(outside, 's.md'), path.join(memory, 'link.md'));
  await fs.symlink(outside, path.join(memory, 'linkdir'));
  assert.ok(!(await titles(ctx, 'founder')).includes('Outside file'));
});

test('C8 frontmatter id shaped like a record id does not collide with the record', async () => {
  const { buildBusinessRule } = await import('./records.mjs');
  const { ctx, store } = await setup({});
  const rule = buildBusinessRule({ role: 'content', rationale: 'r', receiptId: 'audit_1', statement: 'Founders rule zebra', label: 'founders' }, () => new Date('2026-11-01T00:00:00Z'));
  await store.writeRecord(rule);
  await fs.writeFile(path.join(ctx.memoryDirs[0], 'fake.md'), doc(`label: team\nid: ${rule.id}`, 'Fake zebra'));
  const fIdx = (await buildIndex(ctx, 'founder')).items;
  assert.ok(fIdx.some((i) => i.id === rule.id && i.title.includes('Founders rule')), 'record still visible to founder');
  const fake = fIdx.find((i) => i.title === 'Fake zebra');
  assert.ok(fake && fake.id !== rule.id, 'file kept its path-hash id');
  assert.deepEqual((await citeCheck(ctx, 'guest-artist', rule.id)).citations[0].status, 'missing');
});

test('F8 a founder index warning must not reveal another founder\'s personal file path', async () => {
  const { ctx } = await setup({
    'diary-founder-only.md': doc('label: personal\nowner: founder\nid: mem_3333333333333333', 'Diary'),
    'clash.md': doc('label: team\nid: mem_3333333333333333', 'Clash'),
  });
  const w = (await buildIndex(ctx, 'cofounder')).warnings.join('\n');
  assert.ok(!w.includes('diary-founder-only'), w);
});

// ---- hardening added with the fixes -----------------------------------------------
test('H1 a repeated Label/id/owner key in any case withholds the file and warns a founder', async () => {
  const { ctx } = await setup({
    'a.md': doc('label: founders\nLabel: public', 'Case dup'),
    'b.md': doc('label: team\nid: mem_aaaaaaaaaaaaaaaa\nid: mem_bbbbbbbbbbbbbbbb', 'Id dup'),
    'c.md': doc('label: personal\nowner: founder\nowner: cofounder', 'Owner dup'),
    'ok.md': doc('label: team', 'Fine'),
  });
  for (const who of ['bot', 'guest-artist', 'cofounder', 'founder']) assert.deepEqual(await titles(ctx, who).then((t) => t.filter((x) => /dup/i.test(x))), [], who);
  assert.match((await buildIndex(ctx, 'founder')).warnings.join('\n'), /duplicate frontmatter key label/);
});

test('H2 a personal proposal is stamped with its proposer as owner', async () => {
  const { ctx } = await setup({});
  const row = await propose(ctx, 'cofounder', { label: 'personal', title: 'Mine', quote: 'q', source: 's' });
  assert.equal(row.owner, 'cofounder');
  await approve(ctx, 'cofounder', [row.id]);
  assert.deepEqual(await titles(ctx, 'cofounder'), ['Mine']);
  assert.deepEqual(await titles(ctx, 'founder'), []);
});

test('H3 colliding ids among items a reader can see are still withheld', async () => {
  const { ctx } = await setup({
    'a.md': doc('label: team\nid: mem_cccccccccccccccc', 'One'),
    'b.md': doc('label: team\nid: mem_cccccccccccccccc', 'Two'),
  });
  assert.deepEqual(await titles(ctx, 'guest-artist'), []);
});

test('H4 memory directories with the same name are refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-adv-'));
  await assert.rejects(
    buildContext({ data: root, memory: [path.join(root, 'a', 'memory'), path.join(root, 'b', 'memory')] }, {}),
    /distinct names/,
  );
});
