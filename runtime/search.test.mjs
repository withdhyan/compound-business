import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { approve, digest, propose } from './curation.mjs';
import { getItems } from './memory.mjs';
import { buildPolicy } from './policy.mjs';
import { stem, tokenize } from './search.mjs';
import { createCompanyStore } from './store.mjs';

const policy = buildPolicy({ founders: ['founder'], principals: { founder: 'personal', scribe: 'team' } });

async function store(files) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-search-'));
  const memory = path.join(dataDir, 'memory');
  await fs.mkdir(memory, { recursive: true });
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(memory, name), text);
  return { dataDir, ctx: { store: createCompanyStore({ dataDir, policy }), policy, dataDir, memoryDirs: [memory] } };
}

const doc = (label, title, body, extra = '') => `---\nlabel: ${label}\ntitle: ${title}\n${extra}---\n# ${title}\n\n${body}\n`;
const ids = async (ctx, who, q) => (await getItems(ctx, who, q)).results.map((r) => r.title);

test('the stemmer folds inflections and leaves digits and other scripts alone', () => {
  for (const [a, b] of [['funders', 'funded'], ['funding', 'funder'], ['residencies', 'residency'], ['objections', 'objection'], ['stories', 'story']]) {
    assert.equal(stem(a), stem(b), `${a} ~ ${b}`);
  }
  assert.equal(stem('2026'), '2026');
  assert.equal(stem('dhyāna'), 'dhyāna');
  assert.deepEqual(tokenize('The Funders are asking'), [stem('funders'), stem('asking')]);
});

test('stems match across inflections', async () => {
  const { ctx } = await store({ 'a.md': doc('team', 'Residency plan', 'Ten people live in the pilot residencies.'), 'b.md': doc('team', 'Unrelated', 'Nothing here.') });
  assert.equal((await ids(ctx, 'scribe', 'how many people live in the residency'))[0], 'Residency plan');
});

test('built-in synonyms bridge words with no overlap, at a discount to exact words', async () => {
  const { ctx } = await store({
    'a.md': doc('team', 'Funder questions', 'Every funder gets one question about the programme.'),
    'b.md': doc('team', 'Lighting notes', 'The stage lighting is blue.'),
    'c.md': doc('team', 'Story rule', 'A false claim never ships.'),
  });
  assert.equal((await ids(ctx, 'scribe', 'what every backer is asked'))[0], 'Funder questions');
  assert.equal((await ids(ctx, 'scribe', 'an untrue statement'))[0], 'Story rule');
  // an exact word still beats its synonym
  const both = await store({ 'x.md': doc('team', 'About backers', 'backers backers'), 'y.md': doc('team', 'About funders', 'funders funders') });
  assert.equal((await ids(both.ctx, 'scribe', 'backers'))[0], 'About backers');
});

test('aliases are indexed like the title', async () => {
  const { ctx } = await store({
    'a.md': doc('team', 'Compute tranche', 'Hardware spend comes after the pilot.', 'aliases: [gpu budget, accelerators]\n'),
    'b.md': doc('team', 'Other', 'budget budget budget'),
  });
  assert.equal((await ids(ctx, 'scribe', 'accelerators'))[0], 'Compute tranche');
});

test('several phrasings rank the union; a miss on one is covered by another', async () => {
  const { ctx } = await store({ 'a.md': doc('team', 'Kill date', 'Stop the unit when the date passes.'), 'b.md': doc('team', 'Tone', 'Plain words only.') });
  assert.deepEqual(await ids(ctx, 'scribe', 'zzzz qqqq'), []);
  const union = await ids(ctx, 'scribe', 'zzzz qqqq | kill date | plain words');
  assert.equal(union.length, 2);
});

test('ranking never uses items the reader cannot see', async () => {
  const hidden = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`h${i}.md`, doc('founders', `Secret ${i}`, 'raise raise raise')]));
  const open = { 'a.md': doc('team', 'Raise note', 'raise'), 'b.md': doc('team', 'Other note', 'something else') };
  const one = await store(open);
  const two = await store({ ...open, ...hidden });
  const score = async (ctx) => (await ids(ctx, 'scribe', 'raise'));
  assert.deepEqual(await score(two.ctx), await score(one.ctx));
  assert.deepEqual(await ids(two.ctx, 'scribe', 'secret'), []);
});

test('propose --aliases reaches the digest and the approved item', async () => {
  const { ctx } = await store({});
  const { id } = await propose(ctx, 'scribe', { label: 'team', title: 'Compute plan', quote: 'q', source: 's', aliases: 'gpu, graphics cards' });
  assert.deepEqual((await digest(ctx, 'founder')).rows[0].aliases, ['gpu', 'graphics cards']);
  await approve(ctx, 'founder', [id]);
  assert.equal((await ids(ctx, 'scribe', 'gpu'))[0], 'Compute plan');
  await assert.rejects(propose(ctx, 'scribe', { label: 'team', title: 't', quote: 'q2', source: 's', aliases: 'x'.repeat(80) }), /aliases/);
});
