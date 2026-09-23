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
