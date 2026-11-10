import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  addIdea,
  advanceIdea,
  amplifyIdea,
  decideIdea,
  evaluateIdea,
  findIdea,
  listIdeas,
  mineIntoStore,
} from './cli.mjs';
import { createCompanyStore } from './store.mjs';

async function tempStore() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-cli-'));
  return createCompanyStore({ dataDir });
}

function variant(title) {
  return {
    title,
    angle: 'wedge',
    oneLiner: 'one line',
    firstBuild: 'a script',
    why10x: 'compounds',
  };
}

test('the creator loop runs seed → amplified → decided → building → shipped', async () => {
  const store = await tempStore();
  const seed = await addIdea(store, { statement: 'A miner for my notes' });
  assert.equal(seed.status, 'seed');
  await assert.rejects(() => addIdea(store, { statement: 'A miner for my notes' }), /already recorded/);

  const amplified = await amplifyIdea(store, seed.id, [variant('Miner'), variant('Scheduler')]);
  assert.equal(amplified.status, 'amplified');
  assert.equal(amplified.variants.length, 2);

  await assert.rejects(
    () => advanceIdea(store, amplified.id, { status: 'shipped' }),
    /idea history refuses amplified → shipped|needs at least one chosen/,
  );

  const evaluated = await evaluateIdea(store, amplified.id, {
    verdict: 'amplify',
    scores: { pull: 7, fit: 9 },
    note: 'the founder already does this by hand',
  });
  assert.equal(evaluated.evaluation.verdict, 'amplify');

  const decided = await decideIdea(store, evaluated.id, { variant: 'Miner', note: 'start with the miner' });
  assert.equal(decided.status, 'decided');
  assert.deepEqual(decided.chosenVariants, ['Miner']);

  const building = await advanceIdea(store, decided.id, { status: 'building' });
  const shipped = await advanceIdea(store, building.id, { status: 'shipped' });
  assert.equal(building.status, 'building');
  assert.equal(shipped.status, 'shipped');

  const live = await listIdeas(store);
  assert.equal(live.length, 1);
  assert.equal(live[0].id, shipped.id);
  assert.equal((await findIdea(store, 'miner for my notes')).id, shipped.id);
  await assert.rejects(() => advanceIdea(store, shipped.id, { status: 'dropped' }), /idea history refuses shipped/);
});

test('mine writes seeds from configured history and dedupes on the next run', async () => {
  const store = await tempStore();
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-mine-config-'));
  const notes = path.join(workdir, 'notes');
  await fs.mkdir(notes);
  await fs.writeFile(path.join(notes, 'ideas.md'), '- Mine my email for commitments\n- Mine my notes for ideas\n');
  const config = path.join(workdir, 'sources.json');
  await fs.writeFile(config, JSON.stringify({ sources: [{ path: notes }] }));

  const first = await mineIntoStore(store, { config });
  assert.equal(first.length, 2);
  assert.equal(first[0].status, 'seed');
  assert.match(first[0].source, /ideas\.md:1$/);

  const second = await mineIntoStore(store, { config });
  assert.equal(second.length, 0);
});

// ---- the memory surface, through the real CLI -------------------------------

import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));

function cb(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

async function world() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-cli-mem-'));
  await fs.mkdir(path.join(dataDir, 'memory'));
  await fs.writeFile(path.join(dataDir, 'policy.json'), JSON.stringify({
    owner: 'founder',
    founders: ['founder', 'cofounder'],
    principals: { founder: 'personal', cofounder: 'founders', 'guest-artist': 'team' },
    externals: { artist: [] },
  }));
  await fs.writeFile(path.join(dataDir, 'memory', 'a.md'), '---\nlabel: team\ntitle: Residency terms\n---\nThree months.\n');
  await fs.writeFile(path.join(dataDir, 'memory', 'f.md'), '---\nlabel: founders\ntitle: Residency budget\n---\nSecret.\n');
  await fs.writeFile(path.join(dataDir, 'memory', 'u.md'), '# Residency draft\n\nno label\n');
  return dataDir;
}

test('cb get/index/show honour --as, and --as is required', async () => {
  const data = await world();
  const guestArtist = JSON.parse((await cb(['--data', data, 'get', 'residency', '--as', 'guest-artist', '--json'])).stdout);
  assert.deepEqual(guestArtist.results.map((r) => r.title), ['Residency terms']);
  const cofounder = JSON.parse((await cb(['--data', data, 'get', 'residency', '--as', 'cofounder', '--json'])).stdout);
  assert.deepEqual(cofounder.results.map((r) => r.title).sort(), ['Residency budget', 'Residency terms']);
  const index = JSON.parse((await cb(['--data', data, 'index', '--as', 'guest-artist', '--json'])).stdout);
  assert.equal(index.items.length, 1);
  const show = await cb(['--data', data, 'show', guestArtist.results[0].id, '--as', 'guest-artist']);
  assert.match(show.stdout, /Three months/);
  const noAs = await cb(['--data', data, 'get', 'residency']);
  assert.notEqual(noAs.code, 0);
  assert.match(noAs.stderr, /--as <principal> is required/);
  const hidden = await cb(['--data', data, 'show', cofounder.results.find((r) => r.title === 'Residency budget').id, '--as', 'guest-artist']);
  assert.notEqual(hidden.code, 0);
});

test('cb cite-check exits 1 on a missing citation and reads stdin', async () => {
  const data = await world();
  const id = JSON.parse((await cb(['--data', data, 'get', 'terms', '--as', 'guest-artist', '--json'])).stdout).results[0].id;
  const good = path.join(data, 'good.txt');
  const bad = path.join(data, 'bad.txt');
  await fs.writeFile(good, `see ${id}`);
  await fs.writeFile(bad, `see ${id} and mem_ffffffffffffffff`);
  assert.equal((await cb(['--data', data, 'cite-check', good, '--as', 'guest-artist'])).code, 0);
  const failed = await cb(['--data', data, 'cite-check', bad, '--as', 'guest-artist']);
  assert.equal(failed.code, 1);
  assert.match(failed.stdout, /mem_ffffffffffffffff  missing/);
});

test('cb propose is invisible until cb approve; approve is founder-only', async () => {
  const data = await world();
  const proposed = JSON.parse((await cb([
    '--data', data, 'propose', '--as', 'guest-artist', '--label', 'team', '--title', 'Lesson',
    '--quote', 'verbatim words', '--source', 'thread 1', '--json',
  ])).stdout);
  const search = async (as) => JSON.parse((await cb(['--data', data, 'get', 'lesson', '--as', as, '--json'])).stdout).results;
  assert.deepEqual(await search('cofounder'), []);
  assert.notEqual((await cb(['--data', data, 'approve', proposed.id, '--as', 'guest-artist'])).code, 0);
  assert.equal((await cb(['--data', data, 'approve', proposed.id, '--as', 'cofounder'])).code, 0);
  assert.equal((await search('guest-artist')).length, 1);
});

test('cb eval reports recall and fails below --min', async () => {
  const data = await world();
  const id = JSON.parse((await cb(['--data', data, 'get', 'terms', '--as', 'guest-artist', '--json'])).stdout).results[0].id;
  const tasks = path.join(data, 'tasks.json');
  await fs.writeFile(tasks, JSON.stringify([
    { query: 'residency terms', expect: [id] },
    { query: 'nonsense zzz', expect: [id] },
  ]));
  const run = await cb(['--data', data, 'eval', '--as', 'guest-artist', '--file', tasks]);
  assert.equal(run.code, 0);
  assert.match(run.stdout, /recall 0\.500 \(1\/2\)/);
  assert.equal((await cb(['--data', data, 'eval', '--as', 'guest-artist', '--file', tasks, '--min', '0.9'])).code, 1);
});

test('idea add --label makes an idea findable within its grant; unlabelled stays unreadable', async () => {
  const data = await world();
  await cb(['--data', data, 'idea', 'add', 'A labelled zebra idea', '--label', 'team']);
  await cb(['--data', data, 'idea', 'add', 'An unlabelled zebra idea']);
  const found = JSON.parse((await cb(['--data', data, 'get', 'zebra', '--as', 'guest-artist', '--json'])).stdout).results;
  assert.deepEqual(found.map((r) => r.title), ['A labelled zebra idea']);
  // the label survives supersession (amplify)
  const variants = path.join(data, 'v.json');
  await fs.writeFile(variants, JSON.stringify([variant('One')]));
  const amplified = await cb(['--data', data, 'idea', 'amplify', 'A labelled zebra idea', '--file', variants, '--json']);
  assert.equal(amplified.code, 0, amplified.stderr);
  assert.equal(JSON.parse(amplified.stdout).label, 'team');
  const after = JSON.parse((await cb(['--data', data, 'get', 'zebra', '--as', 'guest-artist', '--json'])).stdout).results;
  assert.equal(after.filter((r) => !r.superseded).length, 1);
});

test('a policy file configures a non-revenue stage ladder', async () => {
  const data = await world();
  const policyFile = path.join(data, 'policy.json');
  const raw = JSON.parse(await fs.readFile(policyFile, 'utf8'));
  raw.stages = [
    { name: 'measures', bindingConstraint: 'a signed partner', exitCriteria: ['partner_signed'] },
    { name: 'k_loop', bindingConstraint: 'a measured loop', exitCriteria: ['loop_metric'] },
  ];
  await fs.writeFile(policyFile, JSON.stringify(raw));
  const { buildContext } = await import('./cli.mjs');
  const { buildBusinessStage } = await import('./records.mjs');
  const ctx = await buildContext({ data });
  const stage = buildBusinessStage({ stage: 'measures', evidenceIds: ['bmet_1'] }, () => new Date(), ctx.policy);
  await ctx.store.writeRecord(stage);
  await assert.rejects(
    () => ctx.store.writeRecord(buildBusinessStage({ stage: 'pmf', evidenceIds: ['bmet_1'], dedupeKey: 'other' }, () => new Date())),
    /invalid business stage/,
  );
  const missing = await cb(['--data', data, '--policy', path.join(data, 'nope.json'), 'index', '--as', 'guest-artist']);
  assert.notEqual(missing.code, 0);
});

test('cb mcp speaks JSON-RPC over stdio, bound to --as', async () => {
  const data = await world();
  const child = spawn(process.execPath, [CLI, '--data', data, 'mcp', '--as', 'guest-artist'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const out = [];
  child.stdout.on('data', (chunk) => out.push(chunk));
  const call = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cb_get', arguments: { query: 'residency' } } };
  child.stdin.end(`${JSON.stringify(call)}\n`);
  await new Promise((resolve) => child.on('close', resolve));
  const reply = JSON.parse(Buffer.concat(out).toString().trim());
  assert.deepEqual(JSON.parse(reply.result.content[0].text).results.map((r) => r.title), ['Residency terms']);
});
