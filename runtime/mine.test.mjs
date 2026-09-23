import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { extractCandidates, mineSources, normalizeStatement } from './mine.mjs';

test('inbox mode takes every real line; marker mode only marked lines', () => {
  const text = [
    '# Ideas',
    '- A CLI that mines notes for ideas',
    'Buy milk and eggs tomorrow',
    'what if the runtime could auto-run this',
    'https://example.com/some/link',
    'short',
  ].join('\n');

  const inbox = extractCandidates(text, { mode: 'inbox' }).map((candidate) => candidate.statement);
  assert.deepEqual(inbox, [
    'A CLI that mines notes for ideas',
    'Buy milk and eggs tomorrow',
    'what if the runtime could auto-run this',
  ]);

  const marker = extractCandidates(text, { mode: 'marker' }).map((candidate) => candidate.statement);
  assert.deepEqual(marker, ['the runtime could auto-run this']);

  assert.equal(normalizeStatement('A CLI, that mines!'), 'a cli that mines');
});

test('mineSources walks dirs, dedupes, and respects ignore and limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-mine-'));
  await fs.mkdir(path.join(root, 'notes', 'sub'), { recursive: true });
  await fs.mkdir(path.join(root, 'notes', 'node_modules'), { recursive: true });
  await fs.writeFile(path.join(root, 'notes', 'ideas.md'), [
    '- First real idea about mining',
    '- First real idea about mining',
    '- Second idea about evaluation',
  ].join('\n'));
  await fs.writeFile(
    path.join(root, 'notes', 'journal.md'),
    'Idea: third one from a marker line\njust a normal sentence here\n',
  );
  await fs.writeFile(path.join(root, 'notes', 'sub', 'more.md'), 'Someday build a scheduler for this\n');
  await fs.writeFile(path.join(root, 'notes', 'node_modules', 'x.md'), 'what if this is ignored\n');

  const mined = await mineSources({
    sources: [{ path: path.join(root, 'notes') }],
    existingStatements: ['Second idea about evaluation'],
    ignore: ['node_modules'],
  });
  assert.deepEqual(mined.map((candidate) => candidate.statement), [
    'First real idea about mining',
    'third one from a marker line',
    'build a scheduler for this',
  ]);
  assert.match(mined[0].source, /ideas\.md:1$/);

  const limited = await mineSources({
    sources: [{ path: path.join(root, 'notes') }],
    ignore: ['node_modules'],
    limit: 1,
  });
  assert.equal(limited.length, 1);
});
