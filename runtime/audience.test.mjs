import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FlowTracker, canReadAll, passFor, principalsFor } from './audience.mjs';
import { buildIndex, getItems, showItem } from './memory.mjs';
import { handleMessage } from './mcp.mjs';
import { buildPolicy, canRead } from './policy.mjs';
import { createCompanyStore } from './store.mjs';

const K = { founder: 'aa01', cofounder: 'aa02', member: 'aa03', agent: 'bb01', partner: 'cc01', stranger: 'dd01' };
const ID = {
  public: 'mem_0000000000000001',
  team: 'mem_0000000000000002',
  founders: 'mem_0000000000000003',
  personal: 'mem_0000000000000004',
  shared: 'mem_0000000000000005',
  sharedFounders: 'mem_0000000000000006',
};

const policy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', member: 'team' },
  pubkeys: { [K.founder]: 'founder', [K.cofounder]: 'cofounder', [K.member]: 'member', [K.partner]: 'partner-x' },
  agents: [K.agent],
  partners: { ccs: { members: ['partner-x'], share: [ID.shared, ID.sharedFounders] } },
});

async function ctx() {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-aud-'));
  const memory = path.join(dataDir, 'memory');
  await fs.mkdir(memory);
  const write = (file, id, label, extra = '') => fs.writeFile(path.join(memory, file), `---\nid: ${id}\nlabel: ${label}\n${extra}title: ${file}\n---\nbody ${file}\n`);
  await write('public.md', ID.public, 'public');
  await write('team.md', ID.team, 'team');
  await write('founders.md', ID.founders, 'founders');
  await write('personal.md', ID.personal, 'personal', 'owner: founder\n');
  await write('shared.md', ID.shared, 'team');
  await write('shared-founders.md', ID.sharedFounders, 'founders');
  return { store: createCompanyStore({ dataDir, policy }), memoryDirs: [memory], policy, dataDir };
}

const idsFor = async (c, keys, ceiling = 'personal') => {
  const pass = passFor(policy, principalsFor(policy, keys), ceiling);
  const { items } = await buildIndex(c, pass);
  return items.map((item) => item.id).sort();
};
const want = (...names) => names.map((name) => ID[name]).sort();

test('leak matrix: an audience reads what every member reads', async () => {
  const c = await ctx();
  assert.deepEqual(await idsFor(c, [K.founder]), want('public', 'team', 'founders', 'personal', 'shared', 'sharedFounders'));
  assert.deepEqual(await idsFor(c, [K.founder, K.cofounder]), want('public', 'team', 'founders', 'shared', 'sharedFounders'));
  assert.deepEqual(await idsFor(c, [K.founder, K.member]), want('public', 'team', 'shared'));
  assert.deepEqual(await idsFor(c, [K.founder, K.stranger]), want('public'));
  assert.deepEqual(await idsFor(c, []), want('public'));
});

test('a partner alone reads public plus the shared team item, and no other team item', async () => {
  const c = await ctx();
  assert.deepEqual(await idsFor(c, [K.partner]), want('public', 'shared'));
  assert.deepEqual(await idsFor(c, [K.partner, K.member]), want('public', 'shared'));
});

test('an unmapped pubkey is a guest with no shares', () => {
  assert.deepEqual(principalsFor(policy, [K.stranger.toUpperCase()]), [`guest:${K.stranger}`]);
  assert.ok(canRead(policy, `guest:${K.stranger}`, 'public'));
  assert.ok(!canRead(policy, `guest:${K.stranger}`, 'team', null, { id: ID.shared, path: 'x' }));
  assert.ok(!canReadAll(policy, [`guest:${K.stranger}`], { id: ID.team, label: 'team' }));
});

test('own agents are not part of the audience', () => {
  assert.deepEqual(principalsFor(policy, [K.founder, K.agent]), ['founder']);
  assert.deepEqual(principalsFor(policy, [K.agent]), []);
  assert.deepEqual(principalsFor(policy, [K.founder, K.founder]), ['founder']);
});

test('the zone ceiling clamps the audience, never raises it', async () => {
  const c = await ctx();
  assert.deepEqual(await idsFor(c, [K.founder], 'team'), want('public', 'team', 'shared'));
  assert.deepEqual(await idsFor(c, [K.founder], 'public'), want('public'));
  assert.deepEqual(await idsFor(c, [K.stranger], 'personal'), want('public'));
  assert.throws(() => passFor(policy, ['founder'], 'bogus'), /invalid label/);
  assert.throws(() => passFor(policy, ['founder']), /label is required/);
});

test('partner shares never lift a founders or personal item', async () => {
  const c = await ctx();
  assert.ok(!canRead(policy, 'partner-x', 'founders', null, { id: ID.sharedFounders, path: 'memory/shared-founders.md' }));
  const pass = passFor(policy, principalsFor(policy, [K.partner]), 'personal');
  await assert.rejects(showItem(c, pass, ID.sharedFounders), /no item/);
  await assert.rejects(showItem(c, pass, ID.founders), /no item/);
  assert.equal((await showItem(c, pass, ID.shared)).id, ID.shared);
});

test('a forged pass is not a pass', async () => {
  const c = await ctx();
  await assert.rejects(buildIndex(c, { kind: 'pass', members: [], ceiling: 'personal', name: 'x' }), /principal/);
});

test('getItems and showItem answer under a pass; outside it is a missing item', async () => {
  const c = await ctx();
  const pass = passFor(policy, principalsFor(policy, [K.founder, K.member]), 'personal');
  assert.deepEqual((await getItems(c, pass, 'body')).results.map((r) => r.id).sort(), want('public', 'team', 'shared'));
  await assert.rejects(showItem(c, pass, ID.founders), /no item/);
});

test('flow: a founders item read cannot go to a team audience; narrowing is fine', () => {
  const flow = new FlowTracker();
  assert.deepEqual(flow.checkEgress(policy, ['member']), { ok: true });
  flow.observe({ id: ID.founders, label: 'founders', path: 'p' });
  const team = flow.checkEgress(policy, principalsFor(policy, [K.founder, K.member]));
  assert.equal(team.ok, false);
  assert.deepEqual(team.offending, [ID.founders]);
  assert.deepEqual(flow.checkEgress(policy, ['cofounder', 'founder']), { ok: true });
  assert.equal(flow.checkEgress(policy, principalsFor(policy, [K.stranger])).ok, false);
  assert.equal(flow.checkEgress(policy, []).ok, false);
});

test('flow: public items go anywhere, team items go to team and no further', () => {
  const flow = new FlowTracker();
  flow.observe({ id: ID.public, label: 'public' });
  assert.deepEqual(flow.checkEgress(policy, []), { ok: true });
  flow.observe({ id: ID.team, label: 'team', path: 'p' });
  assert.deepEqual(flow.checkEgress(policy, ['member']), { ok: true });
  assert.equal(flow.checkEgress(policy, [`guest:${K.stranger}`]).ok, false);
});

test('flow: unresolved input holds', () => {
  const flow = new FlowTracker();
  flow.observe({ id: ID.public, label: 'public' });
  flow.observe({ id: 'mem_x', label: 'nonsense' });
  const held = flow.checkEgress(policy, ['founder']);
  assert.equal(held.ok, false);
  assert.ok(held.hold);
  const other = new FlowTracker();
  other.observe(undefined);
  assert.equal(other.checkEgress(policy, []).ok, false);
  assert.equal(new FlowTracker().checkEgress(policy, undefined).ok, false);
});

test('mcp serve resolver: asked on every call; failure is no access', async () => {
  const c = await ctx();
  let audience = [K.founder];
  const resolve = async () => passFor(policy, principalsFor(policy, audience), 'personal');
  const msg = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'cb_index', arguments: {} } };
  const count = async (launch) => JSON.parse((await handleMessage(c, 'founder', msg, launch)).result.content[0].text).count;
  assert.equal(await count({ resolve }), 6);
  audience = [K.founder, K.stranger];
  assert.equal(await count({ resolve }), 1);
  const failing = await handleMessage(c, 'founder', msg, { resolve: async () => { throw new Error('relay down'); } });
  assert.equal(failing.result.isError, true);
  const bogus = await handleMessage(c, 'founder', msg, { resolve: async () => undefined });
  assert.equal(bogus.result.isError, true);
  const write = await handleMessage(c, 'founder', { ...msg, params: { name: 'cb_propose', arguments: {} } }, { resolve });
  assert.equal(write.result.isError, true);
  assert.equal(await count({}), 6);
});
