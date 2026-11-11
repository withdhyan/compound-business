import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { executeMemoryCommand } from './cli.mjs';
import { approve, digest, editPending, listPending, propose, reject } from './curation.mjs';
import { recordEval } from './evals.mjs';
import { handleMessage } from './mcp.mjs';
import { runEval } from './memory.mjs';
import { buildPolicy } from './policy.mjs';
import { createCompanyStore } from './store.mjs';
import { showTrace, suggestTriage } from './trace.mjs';
import { holdoutFile, listHoldout, runHoldout, triage } from './triage.mjs';

const policy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', teammate: 'team', scribe: 'team' },
});
const RULES = 'mem_aaaaaaaaaaaaaaaa';

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-triage-'));
  const memory = path.join(dataDir, 'memory');
  await fs.mkdir(memory, { recursive: true });
  await fs.writeFile(path.join(memory, 'rules.md'), `---\nid: ${RULES}\nlabel: team\ntitle: Growth rules\n---\nNever discount before a signed LOI.\n`);
  const ctx = { store: createCompanyStore({ dataDir, policy }), policy, dataDir, memoryDirs: [memory] };
  return { dataDir, ctx };
}

async function rejected(ctx, over = {}) {
  const row = await propose(ctx, 'scribe', { label: 'team', title: 'Discount in week one', quote: 'discount early', source: 'thread', ...over });
  await reject(ctx, 'founder', [row.id], { note: 'no' });
  return row.id;
}

const lines = async (file) => (await fs.readFile(file, 'utf8').catch(() => '')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('exception: stored as context on the trace, never a rule, never an eval case', async () => {
  const { ctx } = await setup();
  const id = await rejected(ctx);
  const done = await triage(ctx, 'founder', id, 'exception', { note: 'one-off: this partner is on a legacy contract' });
  assert.equal(done.triage.class, 'exception');
  assert.equal(done.triage.note, 'one-off: this partner is on a legacy contract');
  assert.deepEqual(await listPending(ctx, 'founder'), [], 'no proposal was queued');
  assert.deepEqual(await lines(holdoutFile(ctx)), [], 'no eval case was written');
  await assert.rejects(triage(ctx, 'founder', id, 'exception', { note: 'again' }), /already triaged as exception/);
  await assert.rejects(triage(ctx, 'founder', id, 'system', { note: 'x' }), /already triaged/);
});

test('exception and system need the founder\'s words', async () => {
  const { ctx } = await setup();
  const id = await rejected(ctx);
  await assert.rejects(triage(ctx, 'founder', id, 'exception', {}), /needs --note/);
  await assert.rejects(triage(ctx, 'founder', id, 'system', {}), /needs --note/);
  await assert.rejects(triage(ctx, 'founder', id, 'rule', { note: 'x' }), /class must be one of/);
});

test('test: appends a frozen query case or a draft case to the holdout, and nothing else', async () => {
  const { ctx } = await setup();
  const a = await rejected(ctx);
  const done = await triage(ctx, 'founder', a, 'test', { query: 'discount policy', expect: [RULES] });
  assert.match(done.triage.caseId, /^case_[0-9a-f]{16}$/);
  const b = await rejected(ctx, { title: 'Reply to the press', quote: 'press quote' });
  await triage(ctx, 'founder', b, 'test', { draft: 'Thanks for reaching out...', verdict: 'fix', note: 'too eager' });
  const rows = await lines(holdoutFile(ctx));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].case, { query: 'discount policy', expect: [RULES] });
  assert.equal(rows[0].label, 'team');
  assert.deepEqual(rows[1].case, { draft: 'Thanks for reaching out...', verdict: 'FIX' });
  assert.deepEqual((await listPending(ctx, 'founder')), []);
  // the case must be well-formed
  const c = await rejected(ctx, { title: 'Third', quote: 'third' });
  await assert.rejects(triage(ctx, 'founder', c, 'test', {}), /a test needs/);
  await assert.rejects(triage(ctx, 'founder', c, 'test', { query: 'q', expect: ['mem_ffffffffffffffff'] }), /does not resolve/);
  await assert.rejects(triage(ctx, 'founder', c, 'test', { draft: 'd', verdict: 'maybe' }), /verdict must be one of/);
  assert.equal((await showTrace(ctx, 'founder', c)).triage, null, 'a refused triage leaves the trace untouched');
});

test('system: queues a pending proposal to change a rulebook item; a founder still approves', async () => {
  const { ctx } = await setup();
  const id = await rejected(ctx);
  const done = await triage(ctx, 'founder', id, 'system', {
    note: 'we never discount before a signed LOI, at any size',
    target: RULES,
    body: 'Never discount before a signed LOI, at any size.',
  });
  assert.match(done.triage.proposalId, /^mem_[0-9a-f]{16}$/);
  const pending = await listPending(ctx, 'founder');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].supersedes, RULES);
  assert.equal(pending[0].quote, 'we never discount before a signed LOI, at any size');
  assert.match(pending[0].source, /^triage of btrace_[0-9a-f]{24}$/);
  assert.equal(pending[0].label, 'team');
  assert.deepEqual(await lines(holdoutFile(ctx)), []);
  // nothing is live until approval
  const rules = await fs.readdir(path.join(ctx.memoryDirs[0])).catch(() => []);
  assert.deepEqual(rules, ['rules.md']);
  await approve(ctx, 'founder', [done.triage.proposalId]);
});

test('triage permissions: founder-only; agents may only suggest, and only what they can read', async () => {
  const { ctx } = await setup();
  const id = await rejected(ctx);
  for (const who of ['scribe', 'teammate', 'stranger']) {
    await assert.rejects(triage(ctx, who, id, 'exception', { note: 'x' }), /only a founder/, who);
  }
  const suggested = await suggestTriage(ctx, 'scribe', id, 'system', 'looks like a rule');
  assert.equal(suggested.triage, null);
  assert.deepEqual(suggested.suggestions.map((s) => [s.class, s.by]), [['system', 'scribe']]);
  assert.equal((await suggestTriage(ctx, 'scribe', id, 'system')).suggestions.length, 1, 'same suggestion twice is one');
  await assert.rejects(suggestTriage(ctx, 'scribe', id, 'nonsense'), /class must be one of/);
  await assert.rejects(suggestTriage(ctx, 'stranger', id, 'test'), /no trace/);
  assert.equal((await showTrace(ctx, 'founder', id)).triage, null);
  assert.deepEqual(await lines(holdoutFile(ctx)), []);
  assert.deepEqual(await listPending(ctx, 'founder'), []);
});

test('a founder cannot triage a trace they cannot read', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-triage-'));
  const narrow = buildPolicy({ owner: 'founder', founders: ['founder', 'junior'], principals: { founder: 'personal', junior: 'founders', scribe: 'founders' } });
  const ctx = { store: createCompanyStore({ dataDir, policy: narrow }), policy: narrow, dataDir, memoryDirs: [path.join(dataDir, 'memory')] };
  const row = await propose(ctx, 'founder', { label: 'personal', title: 'Private note', quote: 'q', source: 's' });
  await reject(ctx, 'founder', [row.id]);
  await assert.rejects(triage(ctx, 'junior', row.id, 'exception', { note: 'x' }), /no trace/);
});

test('digest lists untriaged corrections with the three choices, and drops them once triaged', async () => {
  const { ctx } = await setup();
  const a = await rejected(ctx);
  const b = await propose(ctx, 'scribe', { label: 'team', title: 'Weekend sends', quote: 'send weekends', source: 's' });
  await editPending(ctx, 'founder', b.id, { title: 'Weekday sends' });
  await suggestTriage(ctx, 'scribe', a, 'test');
  const clean = await propose(ctx, 'scribe', { label: 'team', title: 'Untouched', quote: 'plain', source: 's' });
  const out = await digest(ctx, 'founder');
  assert.equal(out.count, 2, 'pending: the edited one and the untouched one');
  assert.equal(out.untriagedCount, 2);
  const byId = Object.fromEntries(out.untriaged.map((t) => [t.subject, t]));
  assert.deepEqual(byId['Discount in week one'].choices, ['exception', 'test', 'system']);
  assert.equal(byId['Discount in week one'].how, 'rejected');
  assert.deepEqual(byId['Discount in week one'].suggestions, [{ class: 'test', by: 'scribe' }]);
  assert.match(byId['Weekend sends'].edits[0], /title: "Weekend sends" -> "Weekday sends"/);
  assert.ok(!('Untouched' in byId), 'an untouched proposal is not a correction');
  // the text a founder sees
  const text = (await executeMemoryCommand('digest', [], { as: 'founder', json: false }, ctx)).value;
  assert.ok(text.untriaged.length === 2 && text.rows.length === 2);
  await triage(ctx, 'founder', a, 'exception', { note: 'one-off' });
  assert.equal((await digest(ctx, 'founder')).untriagedCount, 1);
  // a non-founder never gets a digest
  await assert.rejects(digest(ctx, 'scribe'), /only a founder/);
  void clean;
});

test('digest keeps untriaged corrections the founder cannot read out of sight', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-triage-'));
  const two = buildPolicy({ owner: 'founder', founders: ['founder', 'junior'], principals: { founder: 'personal', junior: 'founders' } });
  const ctx = { store: createCompanyStore({ dataDir, policy: two }), policy: two, dataDir, memoryDirs: [path.join(dataDir, 'memory')] };
  const row = await propose(ctx, 'founder', { label: 'personal', title: 'Private note', quote: 'q', source: 's' });
  await reject(ctx, 'founder', [row.id]);
  assert.equal((await digest(ctx, 'founder')).untriagedCount, 1);
  assert.equal((await digest(ctx, 'junior')).untriagedCount, 0);
});

test('frozen holdout: a separate file, founder-read only, never an eval input, never in the history', async () => {
  const { ctx, dataDir } = await setup();
  const id = await rejected(ctx);
  await triage(ctx, 'founder', id, 'test', { query: 'discount policy', expect: [RULES] });
  const file = holdoutFile(ctx);
  assert.equal(file, path.join(dataDir, 'evals', 'holdout.jsonl'));
  // an ordinary eval run records to history.jsonl, a different file
  const report = await runEval(ctx, 'founder', [{ query: 'growth rules', expect: [RULES] }]);
  await recordEval(ctx, report, { role: 'growth' });
  assert.equal((await lines(file)).length, 1, 'recording an eval does not touch the holdout');
  assert.equal((await lines(path.join(dataDir, 'evals', 'history.jsonl'))).length, 1);
  assert.ok(!JSON.stringify(await lines(path.join(dataDir, 'evals', 'history.jsonl'))).includes('discount policy'));
  // readers
  assert.equal((await listHoldout(ctx, 'founder')).count, 1);
  for (const who of ['scribe', 'teammate', 'stranger']) await assert.rejects(listHoldout(ctx, who), /only a founder/, who);
  const run = await runHoldout(ctx, 'founder');
  assert.equal(run.queryCases, 1);
  assert.equal(run.report.recall, 1);
  assert.equal((await lines(path.join(dataDir, 'evals', 'history.jsonl'))).length, 1, 'a holdout run is not recorded');
  // the CLI will not take the holdout as a tuning file
  await assert.rejects(executeMemoryCommand('eval', [], { as: 'founder', file }, ctx), /frozen holdout/);
  await assert.rejects(executeMemoryCommand('eval', [], { as: 'founder', file: path.join(dataDir, 'evals', '..', 'evals', 'holdout.jsonl') }, ctx), /frozen holdout/);
  // append-only: the same case twice is one line
  const again = await rejected(ctx, { title: 'Discount in week one', quote: 'discount early', source: 'thread 2' });
  await triage(ctx, 'founder', again, 'test', { query: 'discount policy', expect: [RULES] });
  assert.equal((await lines(file)).length, 2, 'a case from a different proposal is kept');
});

test('frozen holdout: no MCP tool reaches it and the retro skill never names it as an input', async () => {
  const { ctx } = await setup();
  const id = await rejected(ctx);
  await triage(ctx, 'founder', id, 'test', { query: 'discount policy', expect: [RULES] });
  const list = await handleMessage(ctx, 'scribe', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  for (const tool of list.result.tools) assert.ok(!/holdout|triage_set/i.test(tool.name), tool.name);
  const trace = JSON.stringify((await handleMessage(ctx, 'scribe', { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cb_trace_show', arguments: { id } } })).result);
  assert.ok(!trace.includes('discount policy'), 'the case text is not on the trace an agent reads');
  const retro = await fs.readFile(new URL('../skills/retro/SKILL.md', import.meta.url), 'utf8');
  assert.match(retro, /holdout/i);
  assert.doesNotMatch(retro, /turn corrections into rules/i);
  assert.doesNotMatch(retro, /cb get "correction"/);
});

test('cli: triage and holdout commands', async () => {
  const { ctx } = await setup();
  const id = await rejected(ctx);
  const run = (group, rest, flags) => executeMemoryCommand(group, rest, flags, ctx);
  await assert.rejects(run('triage', [id, 'test'], { as: 'scribe', query: 'q', expect: RULES }), /only a founder/);
  const done = await run('triage', [id, 'test'], { as: 'cofounder', query: 'discount policy', expect: [RULES], note: 'seen twice' });
  assert.equal(done.value.triage.class, 'test');
  assert.equal((await run('holdout', ['list'], { as: 'founder' })).value.count, 1);
  assert.equal((await run('holdout', ['run'], { as: 'founder' })).value.report.recall, 1);
  await assert.rejects(run('holdout', ['list'], { as: 'scribe' }), /only a founder/);
});

test('T6: the eval guard compares file identity (hard link, symlink, other spelling), not the path string', async () => {
  const { ctx, dataDir } = await setup();
  const id = await rejected(ctx);
  await triage(ctx, 'founder', id, 'test', { query: 'discount policy', expect: [RULES] });
  const file = holdoutFile(ctx);
  const hard = path.join(dataDir, 'copy-hard.jsonl');
  const soft = path.join(dataDir, 'copy-soft.jsonl');
  await fs.link(file, hard);
  await fs.symlink(file, soft);
  const other = path.join(dataDir, 'other.json');
  await fs.writeFile(other, '[]');
  const { isHoldoutPath } = await import('./triage.mjs');
  assert.equal(await isHoldoutPath(ctx, hard), true);
  assert.equal(await isHoldoutPath(ctx, soft), true);
  assert.equal(await isHoldoutPath(ctx, path.join(dataDir, 'evals', '..', 'evals', 'holdout.jsonl')), true);
  assert.equal(await isHoldoutPath(ctx, other), false);
  for (const f of [hard, soft]) await assert.rejects(executeMemoryCommand('eval', [], { as: 'founder', file: f }, ctx), /frozen holdout/);
});
