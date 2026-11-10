import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildIndex,
  citeCheck,
  extractCitations,
  getItems,
  runEval,
  showItem,
} from './memory.mjs';
import { buildPolicy } from './policy.mjs';
import { buildBusinessRule } from './records.mjs';
import { createCompanyStore } from './store.mjs';

const policy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', 'guest-artist': 'team', bot: 'public' },
  externals: { artist: ['mem_ffffffffffffff00'] },
});

async function setup(files = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-memory-'));
  const memory = path.join(root, 'memory');
  await fs.mkdir(memory, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(memory, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, body);
  }
  const store = createCompanyStore({ dataDir: root, policy });
  return { root, memory, store, ctx: { store, memoryDirs: [memory], policy } };
}

const doc = (label, title, extra = '', body = 'Body about pricing and residencies.') =>
  `---\nlabel: ${label}\ntitle: ${title}\n${extra}---\n# ${title}\n\n${body}\n`;

test('an unlabelled or badly labelled file is unreadable to everyone, founder included', async () => {
  const { ctx } = await setup({
    'none.md': '# No label\n\nsecret words here\n',
    'bad.md': doc('secret', 'Bad label'),
    'ok.md': doc('team', 'Fine'),
  });
  for (const principal of ['founder', 'cofounder', 'guest-artist', 'bot']) {
    const titles = (await buildIndex(ctx, principal)).items.map((item) => item.title);
    assert.ok(!titles.includes('No label') && !titles.includes('Bad label'), principal);
  }
  assert.deepEqual((await getItems(ctx, 'founder', 'secret words')).results, []);
  const warnings = (await buildIndex(ctx, 'founder')).warnings.join('\n');
  assert.match(warnings, /none\.md.*unlabelled/);
  assert.match(warnings, /bad\.md/);
  assert.deepEqual((await buildIndex(ctx, 'guest-artist')).warnings, []);
});

test('the index lists path, label, title, summary, updated and superseded-by', async () => {
  const { ctx } = await setup({
    'learnings/a.md': doc('team', 'Pricing rule', 'summary: Never discount in week one.\nupdated: 2026-11-01\nsuperseded-by: learnings/b.md\n'),
    'learnings/b.md': doc('team', 'Pricing rule v2', 'updated: 2026-11-09\n', 'Discount only with a signed LOI.\n\nMore.'),
  });
  const { items } = await buildIndex(ctx, 'guest-artist');
  const a = items.find((item) => item.title === 'Pricing rule');
  const b = items.find((item) => item.title === 'Pricing rule v2');
  assert.equal(a.path, 'memory/learnings/a.md');
  assert.equal(a.label, 'team');
  assert.equal(a.summary, 'Never discount in week one.');
  assert.equal(a.updated, '2026-11-01');
  assert.equal(a.supersededBy, b.id);
  assert.equal(b.summary, 'Discount only with a signed LOI.');
  assert.equal(b.supersededBy, null);
  assert.match(a.id, /^mem_[0-9a-f]{16}$/);
  assert.equal('text' in a, false);
});

test('grants are per principal; personal is owner-only', async () => {
  const { ctx } = await setup({
    'p.md': doc('public', 'Public thing'),
    't.md': doc('team', 'Team thing'),
    'f.md': doc('founders', 'Founders thing'),
    'me.md': doc('personal', 'Personal thing'),
    'cofounder.md': doc('personal', 'cofounder personal', 'owner: cofounder\n'),
  });
  const seen = async (who) => (await buildIndex(ctx, who)).items.map((item) => item.title).sort();
  assert.deepEqual(await seen('bot'), ['Public thing']);
  assert.deepEqual(await seen('guest-artist'), ['Public thing', 'Team thing']);
  assert.deepEqual(await seen('cofounder'), ['Founders thing', 'Public thing', 'Team thing', 'cofounder personal']);
  assert.deepEqual(await seen('founder'), ['Founders thing', 'Personal thing', 'Public thing', 'Team thing']);
  assert.deepEqual(await seen('stranger'), []);
});

test('records are indexed with their label; unlabelled records are unreadable', async () => {
  const { ctx, store } = await setup();
  const base = { role: 'content', rationale: 'r', receiptId: 'audit_1' };
  await store.writeRecord(buildBusinessRule({ ...base, statement: 'Team rule about pricing', label: 'team' }, () => new Date()));
  await store.writeRecord(buildBusinessRule({ ...base, statement: 'Legacy rule about pricing' }, () => new Date()));
  await store.writeRecord(buildBusinessRule({ ...base, statement: 'Founders rule about pricing', label: 'founders' }, () => new Date()));
  const guestArtist = (await buildIndex(ctx, 'guest-artist')).items;
  assert.deepEqual(guestArtist.map((item) => item.title), ['Team rule about pricing']);
  assert.equal(guestArtist[0].kind, 'BusinessRule');
  assert.match(guestArtist[0].id, /^brule_[0-9a-f]{24}$/);
  const founder = (await getItems(ctx, 'founder', 'pricing')).results.map((item) => item.title).sort();
  assert.deepEqual(founder, ['Founders rule about pricing', 'Team rule about pricing']);
});

test('get returns only matching, in-grant items with ids and a snippet', async () => {
  const { ctx } = await setup({
    'a.md': doc('team', 'Residency terms', '', 'Residency lasts three months.'),
    'b.md': doc('team', 'Unrelated', '', 'Nothing here.'),
    'c.md': doc('founders', 'Founders residency note', '', 'Residency budget is secret.'),
  });
  const { results } = await getItems(ctx, 'guest-artist', 'residency');
  assert.deepEqual(results.map((item) => item.title), ['Residency terms']);
  assert.match(results[0].id, /^mem_/);
  assert.match(results[0].snippet, /three months/);
  assert.equal('text' in results[0], false);
  assert.equal((await getItems(ctx, 'cofounder', 'residency')).results.length, 2);
  await assert.rejects(() => getItems(ctx, 'guest-artist', '   '), /query is required/);
});

test('a superseded item shows its replacement, after the live items', async () => {
  const { ctx } = await setup({
    'old.md': doc('team', 'Grant plan', 'superseded-by: new.md\n', 'grant plan old'),
    'new.md': doc('team', 'Grant plan v2', '', 'grant plan new'),
  });
  const { results } = await getItems(ctx, 'guest-artist', 'grant plan');
  assert.deepEqual(results.map((item) => item.title), ['Grant plan v2', 'Grant plan']);
  assert.equal(results[0].superseded, false);
  assert.equal(results[1].superseded, true);
  assert.equal(results[1].replacement.id, results[0].id);
  assert.equal(results[1].replacement.title, 'Grant plan v2');
});

test('a replacement outside the grant is not disclosed', async () => {
  const { ctx } = await setup({
    'old.md': doc('team', 'Plan', 'superseded-by: new.md\n'),
    'new.md': doc('founders', 'Plan v2 secret'),
  });
  const [only] = (await getItems(ctx, 'guest-artist', 'plan')).results;
  assert.equal(only.superseded, true);
  assert.equal(only.replacement, null);
  assert.ok(!JSON.stringify(only).includes('secret'));
});

test('superseded records point to their replacement', async () => {
  const { ctx, store } = await setup();
  const base = { role: 'content', rationale: 'r', receiptId: 'audit_1', label: 'team' };
  const first = buildBusinessRule({ ...base, statement: 'Post on Fridays' }, () => new Date('2026-11-01T00:00:00Z'));
  await store.writeRecord(first);
  const second = buildBusinessRule(
    { ...base, statement: 'Post on Fridays', rationale: 'new reason', supersedes: first.id, dedupeKey: first.dedupeKey },
    () => new Date('2026-11-02T00:00:00Z'),
  );
  await store.supersedeRecord(first.id, second);
  const { results } = await getItems(ctx, 'guest-artist', 'fridays');
  assert.equal(results.length, 2);
  assert.equal(results[0].id, second.id);
  assert.equal(results[1].id, first.id);
  assert.equal(results[1].replacement.id, second.id);
});

test('show returns the body in grant and looks identical to missing out of grant', async () => {
  const { ctx } = await setup({
    't.md': doc('team', 'Team thing', '', 'full body text'),
    'f.md': doc('founders', 'Founders thing'),
  });
  const { items } = await buildIndex(ctx, 'cofounder');
  const t = items.find((item) => item.title === 'Team thing');
  const f = items.find((item) => item.title === 'Founders thing');
  assert.match((await showItem(ctx, 'guest-artist', t.id)).body, /full body text/);
  const outOfGrant = await showItem(ctx, 'guest-artist', f.id).catch((error) => error.message);
  const missing = await showItem(ctx, 'guest-artist', 'mem_0000000000000000').catch((error) => error.message);
  assert.equal(outOfGrant, `no item: ${f.id}`);
  assert.equal(missing, 'no item: mem_0000000000000000');
});

test('cite-check flags missing, superseded and out-of-grant citations', async () => {
  const { ctx } = await setup({
    'old.md': doc('team', 'Old', 'superseded-by: new.md\n'),
    'new.md': doc('team', 'New'),
    'f.md': doc('founders', 'Hidden'),
  });
  const all = (await buildIndex(ctx, 'cofounder')).items;
  const id = (title) => all.find((item) => item.title === title).id;
  const text = [
    `Used [[${id('New')}]] fine.`,
    `Stale: ${id('Old')} here.`,
    `Hidden: ${id('Hidden')}.`,
    'Invented: mem_ffffffffffffffff.',
    `Again ${id('New')} no duplicate.`,
  ].join('\n');
  const report = await citeCheck(ctx, 'guest-artist', text);
  const by = Object.fromEntries(report.citations.map((entry) => [entry.id, entry]));
  assert.equal(by[id('New')].status, 'ok');
  assert.equal(by[id('Old')].status, 'superseded');
  assert.equal(by[id('Old')].replacement, id('New'));
  assert.equal(by[id('Hidden')].status, 'missing');
  assert.equal(by.mem_ffffffffffffffff.status, 'missing');
  assert.equal(report.citations.length, 4);
  assert.equal(by[id('Old')].line, 2);
  assert.equal(report.ok, false);
  assert.equal((await citeCheck(ctx, 'guest-artist', `fine ${id('New')}`)).ok, true);
  assert.equal((await citeCheck(ctx, 'cofounder', `see ${id('Hidden')}`)).ok, true);
});

test('citations are recognised by id shape only', () => {
  const found = extractCitations('x bdec_0123456789abcdef01234567 y mem_0123456789abcdef z agrant_0123456789abcdef01234567 mem_short');
  assert.deepEqual(found.map((entry) => entry.id), ['bdec_0123456789abcdef01234567', 'mem_0123456789abcdef']);
});

test('dot files, symlinks and non-markdown are not indexed', async () => {
  const { ctx, memory, root } = await setup({
    'ok.md': doc('team', 'Fine'),
    '.hidden.md': doc('team', 'Hidden file'),
    'note.txt': doc('team', 'Text file'),
  });
  const outside = path.join(root, 'outside.md');
  await fs.writeFile(outside, doc('public', 'Outside'));
  await fs.symlink(outside, path.join(memory, 'link.md'));
  await fs.symlink(root, path.join(memory, 'linkdir'));
  assert.deepEqual((await buildIndex(ctx, 'founder')).items.map((item) => item.title), ['Fine']);
});

test('two files claiming one id are both withheld, with a warning', async () => {
  const id = 'mem_aaaaaaaaaaaaaaaa';
  const { ctx } = await setup({
    'a.md': doc('team', 'First', `id: ${id}\n`),
    'b.md': doc('team', 'Second', `id: ${id}\n`),
    'c.md': doc('team', 'Third'),
  });
  const index = await buildIndex(ctx, 'founder');
  assert.deepEqual(index.items.map((item) => item.title), ['Third']);
  assert.match(index.warnings.join('\n'), /duplicate id/);
});

test('eval reports recall of expected ids per task and overall', async () => {
  const { ctx } = await setup({
    'a.md': doc('team', 'Residency terms'),
    'b.md': doc('team', 'Grant answers'),
    'f.md': doc('founders', 'Residency budget'),
  });
  const items = (await buildIndex(ctx, 'cofounder')).items;
  const id = (title) => items.find((item) => item.title === title).id;
  const tasks = [
    { query: 'residency', expect: [id('Residency terms'), id('Residency budget')] },
    { query: 'grant', expect: [id('Grant answers')] },
    { query: 'nothing matches', expect: [id('Grant answers')] },
  ];
  const founders = await runEval(ctx, 'cofounder', tasks);
  assert.equal(founders.tasks[0].recall, 1);
  assert.equal(founders.tasks[2].recall, 0);
  assert.deepEqual(founders.tasks[2].missed, [id('Grant answers')]);
  assert.equal(founders.recall, 3 / 4);
  // the same golden tasks under a smaller grant lose the founders item
  assert.equal((await runEval(ctx, 'guest-artist', tasks)).tasks[0].recall, 0.5);
  await assert.rejects(() => runEval(ctx, 'guest-artist', [{ query: 'x', expect: [] }]), /expect/);
});

test('an external reads public plus items shared by id or path, never a tier', async () => {
  const { ctx } = await setup({
    'pub.md': doc('public', 'Brand kit public'),
    'shared.md': doc('team', 'Shared team brief'),
    'unshared.md': doc('team', 'Unshared team brief'),
    'founders.md': doc('founders', 'Founders brief'),
  });
  const index = (await buildIndex(ctx, 'cofounder')).items;
  const sharedItem = index.find((item) => item.title === 'Shared team brief');
  const external = buildPolicy({
    owner: 'founder', founders: ['founder'], principals: { founder: 'personal' },
    externals: { artist: [sharedItem.id, 'memory/founders.md'] },
  });
  const ectx = { ...ctx, policy: external };
  const titles = async (query) => (await getItems(ectx, 'artist', query)).results.map((item) => item.title);
  assert.deepEqual(await titles('brief'), ['Shared team brief']);
  assert.deepEqual(await titles('brand'), ['Brand kit public']);
  assert.deepEqual(await titles('founders'), []);
  assert.deepEqual((await buildIndex(ectx, 'artist')).items.map((item) => item.title).sort(), ['Brand kit public', 'Shared team brief']);
  await assert.rejects(() => showItem(ectx, 'artist', index.find((item) => item.title === 'Unshared team brief').id), /no item/);
  assert.equal((await showItem(ectx, 'artist', sharedItem.id)).title, 'Shared team brief');
  // the same share by path
  const byPath = buildPolicy({
    owner: 'founder', founders: ['founder'], principals: { founder: 'personal' },
    externals: { artist: ['memory/unshared.md'] },
  });
  assert.deepEqual((await getItems({ ...ctx, policy: byPath }, 'artist', 'brief')).results.map((item) => item.title), ['Unshared team brief']);
});
