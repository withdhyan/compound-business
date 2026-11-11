import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { handleMessage } from './mcp.mjs';
import { buildPolicy } from './policy.mjs';
import { createCompanyStore } from './store.mjs';

const policy = buildPolicy({
  owner: 'founder', founders: ['founder'], principals: { founder: 'personal', 'guest-artist': 'team' },
});

async function ctx() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-mcp-'));
  const memory = path.join(dataDir, 'memory');
  await fs.mkdir(memory);
  await fs.writeFile(path.join(memory, 'a.md'), '---\nlabel: team\ntitle: Residency terms\n---\nThree months.\n');
  await fs.writeFile(path.join(memory, 'f.md'), '---\nlabel: founders\ntitle: Residency budget\n---\nSecret.\n');
  return { store: createCompanyStore({ dataDir, policy }), memoryDirs: [memory], policy, dataDir };
}

const call = (name, args, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const text = (response) => JSON.parse(response.result.content[0].text);

test('initialize and tools/list expose the read tools, the trace tools and one propose tool', async () => {
  const c = await ctx();
  const init = await handleMessage(c, 'guest-artist', { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.result.serverInfo.name, 'cb');
  assert.ok(init.result.capabilities.tools);
  const list = await handleMessage(c, 'guest-artist', { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((tool) => tool.name).sort(), ['cb_cite_check', 'cb_get', 'cb_index', 'cb_propose', 'cb_show', 'cb_trace_list', 'cb_trace_show', 'cb_trace_suggest']);
  assert.equal(await handleMessage(c, 'guest-artist', { jsonrpc: '2.0', method: 'notifications/initialized' }), null);
});

test('tools answer within the principal bound at start, never one the caller names', async () => {
  const c = await ctx();
  const found = text(await handleMessage(c, 'guest-artist', call('cb_get', { query: 'residency', as: 'founder', principal: 'founder' })));
  assert.deepEqual(found.results.map((item) => item.title), ['Residency terms']);
  const id = found.results[0].id;
  assert.match(text(await handleMessage(c, 'guest-artist', call('cb_show', { id }))).body, /Three months/);
  const report = text(await handleMessage(c, 'guest-artist', call('cb_cite_check', { text: `${id} mem_ffffffffffffffff` })));
  assert.equal(report.ok, false);
});

test('errors come back as tool errors; unknown methods as JSON-RPC errors', async () => {
  const c = await ctx();
  const bad = await handleMessage(c, 'guest-artist', call('cb_show', { id: 'mem_0000000000000000' }));
  assert.equal(bad.result.isError, true);
  const unknownTool = await handleMessage(c, 'guest-artist', call('cb_write', {}));
  assert.equal(unknownTool.result.isError, true);
  const unknown = await handleMessage(c, 'guest-artist', { jsonrpc: '2.0', id: 9, method: 'nope' });
  assert.equal(unknown.error.code, -32601);
});
