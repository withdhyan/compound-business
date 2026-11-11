import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { approve, digest, editPending, propose, reject } from './curation.mjs';
import { executeMemoryCommand } from './cli.mjs';
import { handleMessage } from './mcp.mjs';
import { getItems } from './memory.mjs';
import { buildPolicy } from './policy.mjs';
import { createCompanyStore } from './store.mjs';
import { listTraces, recordOutcome, showTrace, suggestTriage } from './trace.mjs';

const policy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', teammate: 'team', scribe: 'team', helper: 'team' },
});

async function setup() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-trace-'));
  const memory = path.join(dataDir, 'memory');
  await fs.mkdir(memory, { recursive: true });
  await fs.writeFile(path.join(memory, 'rules.md'), '---\nid: mem_aaaaaaaaaaaaaaaa\nlabel: team\ntitle: Growth rules\n---\nNever discount.\n');
  await fs.writeFile(path.join(memory, 'plan.md'), '---\nid: mem_bbbbbbbbbbbbbbbb\nlabel: founders\ntitle: Founder plan\n---\nSecret plan.\n');
  return { dataDir, ctx: { store: createCompanyStore({ dataDir, policy }), policy, dataDir, memoryDirs: [memory] } };
}

const entry = (over = {}) => ({ label: 'team', title: 'Ship on Fridays', quote: 'we ship Fridays', source: 'thread 2026-11-09', ...over });

test('propose opens a trace; approve, outcome and the history append, never mutate', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  let trace = await showTrace(ctx, 'founder', id);
  assert.equal(trace.decision, 'pending');
  assert.equal(trace.subject, 'Ship on Fridays');
  assert.equal(trace.proposalId, id);
  assert.equal(trace.label, 'team');
  await approve(ctx, 'cofounder', [id]);
  trace = await showTrace(ctx, 'founder', id);
  assert.equal(trace.decision, 'approved');
  assert.equal(trace.decisionId, id);
  assert.equal(trace.decidedBy, 'cofounder');
  assert.equal(trace.isCorrection, false);
  await recordOutcome(ctx, 'founder', trace.id, 'Friday ships doubled replies');
  trace = await showTrace(ctx, 'founder', id);
  assert.equal(trace.outcome, 'Friday ships doubled replies');
  assert.equal(trace.versions, 3);
  // every version is still on disk, one live
  const all = await ctx.store.listRecords('BusinessTrace');
  assert.equal(all.length, 3);
  assert.equal(all.filter((row) => !row.supersededById).length, 1);
});

test('edit and reject append; the trace marks them as corrections and keeps what changed', async () => {
  const { ctx } = await setup();
  const a = await propose(ctx, 'scribe', entry());
  await editPending(ctx, 'founder', a.id, { title: 'Ship on Thursdays', body: 'Thursday, not Friday.' });
  await approve(ctx, 'founder', [a.id]);
  const edited = await showTrace(ctx, 'founder', a.id);
  assert.deepEqual(edited.edits.map((edit) => edit.field), ['title', 'body']);
  assert.equal(edited.edits[0].from, 'Ship on Fridays');
  assert.equal(edited.edits[0].to, 'Ship on Thursdays');
  assert.equal(edited.isCorrection, true);
  const b = await propose(ctx, 'scribe', entry({ title: 'Discount in week one', quote: 'discount early' }));
  await reject(ctx, 'founder', [b.id], { note: 'we never discount' });
  const rejected = await showTrace(ctx, 'founder', b.id);
  assert.equal(rejected.decision, 'rejected');
  assert.equal(rejected.decisionId, null);
  assert.equal(rejected.decisionNote, 'we never discount');
  assert.equal(rejected.isCorrection, true);
});

test('a rejected proposal proposed again gets its own trace', async () => {
  const { ctx } = await setup();
  const first = await propose(ctx, 'scribe', entry());
  await reject(ctx, 'founder', [first.id]);
  const again = await propose(ctx, 'scribe', entry());
  assert.equal(again.id, first.id);
  const { traces } = await listTraces(ctx, 'founder');
  assert.deepEqual(traces.map((t) => t.decision).sort(), ['pending', 'rejected']);
});

test('the store refuses to rewrite a trace: identity, history and decisions are pinned', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  await editPending(ctx, 'founder', id, { summary: 'a summary' });
  await approve(ctx, 'founder', [id]);
  const [live] = (await ctx.store.liveRecords('BusinessTrace'));
  const { buildBusinessTrace } = await import('./records.mjs');
  const base = { ...live, id: undefined, supersedes: live.id, validFrom: new Date(Date.now() + 5000).toISOString(), eventAt: undefined, ingestedAt: undefined };
  const attempt = (patch) => ctx.store.supersedeRecord(live.id, buildBusinessTrace({ ...base, ...patch }, () => new Date(Date.now() + 5000)));
  await assert.rejects(attempt({ subject: 'other' }), /cannot change subject/);
  await assert.rejects(attempt({ edits: [] }), /cannot rewrite edits/);
  await assert.rejects(attempt({ decision: 'rejected', decisionId: null }), /decision is final/);
  await assert.rejects(attempt({ label: 'public' }), /cannot change label/);
});

test('label propagation: a trace takes the max label of what it references', async () => {
  const { ctx } = await setup();
  // a team-labelled proposal that cites a founders item is a founders trace
  const row = await propose(ctx, 'founder', entry({ evidence: ['mem_bbbbbbbbbbbbbbbb'] }));
  const trace = await showTrace(ctx, 'founder', row.id);
  assert.equal(trace.label, 'founders');
  assert.deepEqual(trace.contextIds, ['mem_bbbbbbbbbbbbbbbb']);
  await approve(ctx, 'founder', [row.id]);
  // the team principal cannot read it, by id, by listing, or by suggesting
  assert.deepEqual((await listTraces(ctx, 'teammate')).traces, []);
  await assert.rejects(showTrace(ctx, 'teammate', row.id), /no trace/);
  await assert.rejects(showTrace(ctx, 'teammate', trace.id), /no trace/);
  await assert.rejects(suggestTriage(ctx, 'teammate', trace.id, 'system'), /no trace/);
  // unreadable looks exactly like missing
  await assert.rejects(showTrace(ctx, 'teammate', 'mem_cccccccccccccccc'), /no trace: mem_cccccccccccccccc/);
  // a founder with the grant still reads it
  assert.equal((await listTraces(ctx, 'cofounder')).count, 1);
  // a team-only chain stays team
  const plain = await propose(ctx, 'scribe', entry({ title: 'Plain', quote: 'plain', evidence: ['mem_aaaaaaaaaaaaaaaa'] }));
  await approve(ctx, 'founder', [plain.id]);
  assert.equal((await showTrace(ctx, 'teammate', plain.id)).label, 'team');
});

test('an edit of a team item keeps the edited item as context', async () => {
  const { ctx } = await setup();
  const row = await propose(ctx, 'scribe', entry({ title: 'Growth rules, wk 46', supersedes: 'mem_aaaaaaaaaaaaaaaa', body: 'Never discount; ship Fridays.' }));
  assert.deepEqual((await showTrace(ctx, 'founder', row.id)).contextIds, ['mem_aaaaaaaaaaaaaaaa']);
});

test('a pending trace is visible to founders and its proposer only', async () => {
  const { ctx } = await setup();
  const row = await propose(ctx, 'scribe', entry());
  assert.equal((await listTraces(ctx, 'scribe')).count, 1);
  assert.equal((await listTraces(ctx, 'founder')).count, 1);
  assert.equal((await listTraces(ctx, 'helper')).count, 0);
  await assert.rejects(showTrace(ctx, 'helper', row.id), /no trace/);
  await approve(ctx, 'founder', [row.id]);
  assert.equal((await listTraces(ctx, 'helper')).count, 1);
  // traces are not memory items: nothing leaks through get
  assert.deepEqual((await getItems(ctx, 'founder', 'Ship on Fridays')).results.filter((r) => r.kind === 'BusinessTrace'), []);
});

test('outcome is founder-only; unknown principals read nothing', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  await approve(ctx, 'founder', [id]);
  await assert.rejects(recordOutcome(ctx, 'scribe', id, 'it went well'), /only a founder/);
  await assert.rejects(recordOutcome(ctx, 'founder', id, '   '), /outcome/);
  assert.equal((await listTraces(ctx, 'stranger')).count, 0);
});

test('cli: trace outcome and show', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  await approve(ctx, 'founder', [id]);
  const done = await executeMemoryCommand('trace', ['outcome', id, 'replies', 'doubled'], { as: 'founder' }, ctx);
  assert.equal(done.value.outcome, 'replies doubled');
  const shown = await executeMemoryCommand('trace', ['show', id], { as: 'scribe' }, ctx);
  assert.equal(shown.value.outcome, 'replies doubled');
  await assert.rejects(executeMemoryCommand('trace', ['outcome', id, 'x'], { as: 'scribe' }, ctx), /only a founder/);
});

test('mcp: traces are readable and suggestable, never triage or outcome', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  await reject(ctx, 'founder', [id]);
  const call = (name, args) => handleMessage(ctx, 'scribe', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const text = (res) => JSON.parse(res.result.content[0].text);
  const list = text(await call('cb_trace_list', { untriaged: true }));
  assert.equal(list.count, 1);
  const suggested = text(await call('cb_trace_suggest', { id: list.traces[0].id, class: 'exception', note: 'one-off' }));
  assert.equal(suggested.suggestions[0].class, 'exception');
  const shown = text(await call('cb_trace_show', { id }));
  assert.equal(shown.triage, null, 'a suggestion does not triage');
  assert.equal(shown.suggestions[0].by, 'scribe');
  assert.equal((await call('cb_trace_suggest', { id, class: 'rule' })).result.isError, true);
  for (const name of ['cb_triage', 'cb_trace_outcome', 'cb_holdout']) assert.equal((await call(name, { id })).result.isError, true);
  // the correction is still untriaged for the founder's digest
  assert.equal((await digest(ctx, 'founder')).untriagedCount, 1);
});

// ---- review fixes (T1, T3/T7, T4, T5, T8) -------------------------------------------

async function personalSetup() {
  const { dataDir, ctx } = await setup();
  await fs.writeFile(path.join(ctx.memoryDirs[0], 'mine.md'), '---\nid: mem_cccccccccccccccc\nlabel: personal\nowner: cofounder\ntitle: Cofounder private note\n---\nPrivate.\n');
  return { dataDir, ctx };
}

test('T1: a personal trace belongs to the owner of the personal items it cites, never the policy owner', async () => {
  const { ctx } = await personalSetup();
  const row = await propose(ctx, 'cofounder', entry({ evidence: ['mem_cccccccccccccccc'] }));
  const trace = await showTrace(ctx, 'cofounder', row.id);
  assert.equal(trace.label, 'personal');
  await assert.rejects(showTrace(ctx, 'founder', row.id), /no trace/, 'the policy owner does not get it');
  assert.equal((await listTraces(ctx, 'founder')).count, 0);
  await reject(ctx, 'cofounder', [row.id]);
  assert.equal((await digest(ctx, 'founder')).untriagedCount, 0);
  assert.equal((await digest(ctx, 'cofounder')).untriagedCount, 1);
});

test('T1: with no explicit owner and two founders a personal trace is still its author\'s', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-trace-'));
  const open = buildPolicy({ founders: ['founder', 'cofounder'], principals: { founder: 'personal', cofounder: 'personal', scribe: 'team' } });
  const ctx = { store: createCompanyStore({ dataDir, policy: open }), policy: open, dataDir, memoryDirs: [path.join(dataDir, 'memory')] };
  const row = await propose(ctx, 'cofounder', { label: 'personal', title: 'Mine', quote: 'q', source: 's' });
  assert.equal((await showTrace(ctx, 'cofounder', row.id)).label, 'personal');
  await assert.rejects(showTrace(ctx, 'founder', row.id), /no trace/);
});

test('T3/T7: non-founders see no holdout case id or note, and only their own suggestion notes', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  await reject(ctx, 'founder', [id]);
  await suggestTriage(ctx, 'scribe', id, 'test', 'scribe thinks so');
  await suggestTriage(ctx, 'helper', id, 'system', 'helper private words');
  const { triage } = await import('./triage.mjs');
  await triage(ctx, 'founder', id, 'test', { query: 'ship fridays', expect: ['mem_aaaaaaaaaaaaaaaa'], note: 'tests friday recall' });
  const asFounder = await showTrace(ctx, 'founder', id);
  assert.match(asFounder.triage.caseId, /^case_/);
  assert.equal(asFounder.suggestions.length, 2);
  assert.equal(asFounder.suggestions[1].note, 'helper private words');
  const asScribe = await showTrace(ctx, 'scribe', id);
  assert.deepEqual(Object.keys(asScribe.triage).sort(), ['at', 'by', 'class']);
  assert.equal(asScribe.suggestions.find((s) => s.by === 'scribe').note, 'scribe thinks so');
  assert.equal('note' in asScribe.suggestions.find((s) => s.by === 'helper'), false);
  const listed = (await listTraces(ctx, 'teammate')).traces[0];
  assert.ok(!JSON.stringify(listed).includes('case_') && !JSON.stringify(listed).includes('friday recall') && !JSON.stringify(listed).includes('private words'));
  const viaMcp = JSON.stringify((await handleMessage(ctx, 'teammate', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cb_trace_show', arguments: { id } } })).result);
  assert.ok(!viaMcp.includes('case_') && !viaMcp.includes('private words'));
});

test('T4: a pending proposal displaced by a founder\'s edit closes its trace', async () => {
  const { ctx } = await setup();
  const agent = await propose(ctx, 'scribe', entry({ title: 'Rules v2', supersedes: 'mem_aaaaaaaaaaaaaaaa', body: 'agent version' }));
  const mine = await propose(ctx, 'founder', entry({ title: 'Rules v2 (founder)', quote: 'founder words', supersedes: 'mem_aaaaaaaaaaaaaaaa', body: 'founder version' }));
  assert.notEqual(mine.id, agent.id);
  const displaced = await showTrace(ctx, 'founder', agent.id);
  assert.equal(displaced.decision, 'rejected');
  assert.match(displaced.decisionNote, /displaced/);
  assert.equal(displaced.isCorrection, true);
});

test('T5: a re-proposal gets a fresh trace key; the proposal id resolves to the newest round, the trace id to its own', async () => {
  const { ctx } = await setup();
  const first = await propose(ctx, 'scribe', entry());
  await reject(ctx, 'founder', [first.id]);
  await propose(ctx, 'scribe', entry());
  await reject(ctx, 'founder', [first.id]);
  const third = await propose(ctx, 'scribe', entry());
  const keys = (await ctx.store.listRecords('BusinessTrace')).map((r) => r.dedupeKey);
  assert.equal(new Set(keys).size, 3);
  for (let i = 0; i < 5; i += 1) assert.equal((await showTrace(ctx, 'founder', third.id)).decision, 'pending');
  await recordOutcome(ctx, 'founder', third.id, 'round three outcome');
  const rounds = (await listTraces(ctx, 'founder')).traces;
  assert.deepEqual(rounds.filter((t) => t.outcome).map((t) => t.decision), ['pending']);
  const old = rounds.find((t) => t.decision === 'rejected');
  assert.equal((await showTrace(ctx, 'founder', old.id)).decision, 'rejected');
});

test('T8: a founder edit citing a higher item raises the trace label', async () => {
  const { ctx } = await setup();
  const { id } = await propose(ctx, 'scribe', entry());
  assert.equal((await showTrace(ctx, 'scribe', id)).label, 'team');
  await editPending(ctx, 'founder', id, { body: 'see mem_bbbbbbbbbbbbbbbb for the plan' });
  const raised = await showTrace(ctx, 'founder', id);
  assert.equal(raised.label, 'founders');
  assert.ok(raised.contextIds.includes('mem_bbbbbbbbbbbbbbbb'));
  await assert.rejects(showTrace(ctx, 'scribe', id), /no trace/, 'the team proposer no longer reads the edit text');
  assert.equal((await listTraces(ctx, 'scribe')).count, 0);
  await reject(ctx, 'founder', [id]);
  assert.equal((await showTrace(ctx, 'founder', id)).edits.length, 1);
});
