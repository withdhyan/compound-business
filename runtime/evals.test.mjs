import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evalTrend, recordEval } from './evals.mjs';
import { buildPolicy } from './policy.mjs';

const policy = buildPolicy({ founders: ['founder'], principals: { founder: 'personal', scribe: 'team' } });
const report = (principal, recall) => ({ principal, recall, hits: recall * 10, expected: 10, tasks: [{ query: 'secret client name', recall }] });

async function ctx() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-evals-'));
  return { dataDir, policy };
}

test('recordEval appends one line per run to data/evals/history.jsonl, aggregates only', async () => {
  const c = await ctx();
  await recordEval(c, report('scribe', 0.4), { role: 'growth', at: '2026-11-03T09:00:00.000Z' });
  await recordEval(c, report('scribe', 0.8), { role: 'growth', at: '2026-11-10T09:00:00.000Z' });
  const text = await fs.readFile(path.join(c.dataDir, 'evals', 'history.jsonl'), 'utf8');
  const lines = text.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(lines[0]).sort(), ['at', 'expected', 'hits', 'principal', 'recall', 'role', 'tasks']);
  assert.ok(!text.includes('secret client name'));
});

test('evalTrend shows week-0 against the latest run per role', async () => {
  const c = await ctx();
  await recordEval(c, report('scribe', 0.4), { role: 'growth', at: '2026-11-03T09:00:00.000Z' });
  await recordEval(c, report('scribe', 0.6), { role: 'growth', at: '2026-11-07T09:00:00.000Z' });
  await recordEval(c, report('scribe', 0.8), { role: 'growth', at: '2026-11-10T09:00:00.000Z' });
  await recordEval(c, report('scribe', 0.5), { at: '2026-11-10T09:00:00.000Z' });
  await assert.rejects(() => evalTrend(c, 'scribe'), /only a founder/);
  const { series } = await evalTrend(c, 'founder');
  const growth = series.find((row) => row.key === 'growth');
  assert.equal(growth.runs, 3);
  assert.equal(growth.first.recall, 0.4);
  assert.equal(growth.last.recall, 0.8);
  assert.ok(Math.abs(growth.delta - 0.4) < 1e-9);
  assert.equal(series.find((row) => row.key === 'scribe').runs, 1);
  assert.equal((await evalTrend(c, 'founder', { role: 'growth' })).series.length, 1);
});

test('a missing history is an empty trend and a torn line is skipped, counted', async () => {
  const c = await ctx();
  assert.deepEqual((await evalTrend(c, 'founder')).series, []);
  await recordEval(c, report('scribe', 0.5), { at: '2026-11-03T09:00:00.000Z' });
  await fs.appendFile(path.join(c.dataDir, 'evals', 'history.jsonl'), '{"at":\n');
  const trend = await evalTrend(c, 'founder');
  assert.equal(trend.skipped, 1);
  assert.equal(trend.series.length, 1);
});
