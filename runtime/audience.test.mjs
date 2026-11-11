import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FlowTracker, canReadAll, isPass, passFor, principalsFor, requireFresh } from './audience.mjs';
import { buildIndex, citeCheck, getItems, showItem } from './memory.mjs';
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

// ---- review fixes (probes P1-P14 of the independent review) -----------------

const base = {
  owner: 'founder', founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', member: 'team' },
  pubkeys: { [K.founder]: 'founder', [K.member]: 'member' },
};
const fm = (id, label, extra = '') => `---\nid: ${id}\nlabel: ${label}\n${extra}---\nbody secret-${label}\n`;
const msg = (name = 'cb_index', id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } });

test('P1/F2: an id seen twice never lets the weaker observation clear the stronger', () => {
  const flow = new FlowTracker();
  flow.observe({ id: ID.founders, label: 'founders', path: 'memory/a.md' });
  flow.observe({ id: ID.founders, label: 'public', path: 'memory/b.md' });
  assert.deepEqual(flow.checkEgress(policy, [`guest:${K.stranger}`]), { ok: false, hold: 'audience', offending: [ID.founders] });
});

test('P2/F3: mutating the observed object afterwards changes nothing', () => {
  const flow = new FlowTracker();
  const item = { id: ID.founders, label: 'founders' };
  flow.observe(item);
  item.label = 'public';
  assert.equal(flow.checkEgress(policy, []).ok, false);
});

test('P3/F1: a personal item shown by the tool carries its owner and holds against another reader', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-aud-'));
  const memory = path.join(dataDir, 'memory');
  await fs.mkdir(memory);
  await fs.writeFile(path.join(memory, 'p.md'), fm(ID.personal, 'personal', 'owner: cofounder\n'));
  const c = { store: createCompanyStore({ dataDir, policy }), memoryDirs: [memory], policy, dataDir };
  const pass = passFor(policy, ['cofounder'], 'personal');
  const shown = await showItem(c, pass, ID.personal);
  assert.equal(shown.owner, 'cofounder');
  const flow = new FlowTracker();
  flow.observe(shown);
  assert.equal(flow.checkEgress(policy, ['founder']).ok, false);
  assert.deepEqual(flow.checkEgress(policy, ['cofounder']), { ok: true });
  const out = JSON.parse((await handleMessage(c, 'x', msg(), { resolve: async () => pass })).result.content[0].text);
  assert.equal(out.items[0].owner, 'cofounder');
  const ownerless = new FlowTracker();
  ownerless.observe({ id: ID.personal, label: 'personal' });
  assert.equal(ownerless.checkEgress(policy, ['founder']).hold, 'unresolved');
});

test('P4/F7: cited ids join the egress check; an unresolvable id holds', () => {
  const flow = new FlowTracker();
  const store = { [ID.founders]: { id: ID.founders, label: 'founders' }, [ID.public]: { id: ID.public, label: 'public' } };
  const resolve = (id) => store[id];
  assert.deepEqual(flow.checkEgress(policy, [], { cited: [ID.public], resolve }), { ok: true });
  assert.deepEqual(flow.checkEgress(policy, ['member'], { cited: [ID.founders], resolve }), { ok: false, hold: 'audience', offending: [ID.founders] });
  assert.equal(flow.checkEgress(policy, ['founder'], { cited: ['mem_00000000000000ff'], resolve }).hold, 'unresolved');
  assert.equal(flow.checkEgress(policy, ['founder'], { cited: [ID.public] }).hold, 'unresolved');
  assert.equal(flow.checkEgress(policy, ['founder'], { cited: [ID.public], resolve: () => { throw new Error('x'); } }).hold, 'unresolved');
});

test('P5-P7/F5: conflicting pubkey config is refused', () => {
  assert.throws(() => buildPolicy({ ...base, agents: [K.member] }), /both an agent/);
  assert.throws(() => buildPolicy({ ...base, pubkeys: { AA09: 'member', aa09: 'founder' } }), /duplicate pubkey/);
  assert.throws(() => buildPolicy({ ...base, pubkeys: { ee01: 'Founder' } }), /unknown principal/);
  assert.throws(() => buildPolicy({ ...base, pubkeys: { ee02: 'guest:zz' } }), /guest:/);
});

test('P8/F4: a path share is the canonical full path, never the display path', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-aud-'));
  const m1 = path.join(dataDir, 'a', 'memory');
  const m2 = path.join(dataDir, 'b', 'memory');
  await fs.mkdir(m1, { recursive: true });
  await fs.mkdir(m2, { recursive: true });
  await fs.writeFile(path.join(m1, 'shared.md'), fm(ID.shared, 'team'));
  await fs.writeFile(path.join(m2, 'shared.md'), fm('mem_00000000000000bb', 'team'));
  const byPath = buildPolicy({ ...base, pubkeys: { ...base.pubkeys, [K.partner]: 'partner-x' },
    partners: { ccs: { members: ['partner-x'], share: ['memory/shared.md'] } } });
  const c = { store: createCompanyStore({ dataDir, policy: byPath }), memoryDirs: [m1, m2], policy: byPath, dataDir };
  const pass = passFor(byPath, principalsFor(byPath, [K.partner]), 'personal');
  assert.deepEqual((await buildIndex(c, pass)).items, []);
  const exact = buildPolicy({ ...base, pubkeys: { ...base.pubkeys, [K.partner]: 'partner-x' },
    partners: { ccs: { members: ['partner-x'], share: [path.join(m1, 'shared.md')] } } });
  const c2 = { ...c, policy: exact };
  const ids = (await buildIndex(c2, passFor(exact, ['partner-x'], 'personal'))).items.map((i) => i.id);
  assert.deepEqual(ids, [ID.shared]);
});

test('P9/F6: only a real pass from resolve() enables tools; errors are generic', async () => {
  const c = await ctx();
  const asString = await handleMessage(c, 'member', msg('cb_trace_list'), { resolve: async () => 'founder' });
  assert.equal(asString.result.isError, true);
  assert.match(asString.result.content[0].text, /audience unresolved/);
  const leaky = await handleMessage(c, 'member', msg(), { resolve: async () => { throw new Error('ECONNREFUSED 10.0.0.5:7777 token=abc'); } });
  assert.equal(leaky.result.isError, true);
  assert.equal(leaky.result.content[0].text, 'audience unresolved');
});

test('P10: clones, prototypes and proxies of a pass are not passes; members are frozen', () => {
  const pass = passFor(policy, ['founder'], 'personal');
  assert.equal(isPass(pass), true);
  assert.equal(isPass(structuredClone(pass)), false);
  assert.equal(isPass(Object.create(pass)), false);
  assert.equal(isPass(new Proxy(pass, {})), false);
  assert.throws(() => pass.members.push('x'));
});

test('P11: empty, blank and odd members read public only or nothing', async () => {
  const c = await ctx();
  for (const members of [[], [''], [null], ['__proto__'], ['guest:'], ['founder', '']]) {
    const labels = (await buildIndex(c, passFor(policy, members, 'personal'))).items.map((i) => i.label);
    assert.ok(labels.every((l) => l === 'public'), JSON.stringify(members));
  }
  assert.deepEqual(principalsFor(policy, [null, ' aa01', 'AA01']), ['guest:null', 'guest: aa01', 'founder']);
});

test('P12: cite-check, index and get under a guest pass reveal nothing hidden', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cb-aud-'));
  const memory = path.join(dataDir, 'memory');
  await fs.mkdir(memory);
  await fs.writeFile(path.join(memory, 'a.md'), fm(ID.public, 'public', `superseded-by: ${ID.founders}\n`));
  await fs.writeFile(path.join(memory, 'f.md'), fm(ID.founders, 'founders', 'title: Secret Merger\n'));
  const c = { store: createCompanyStore({ dataDir, policy }), memoryDirs: [memory], policy, dataDir };
  const pass = passFor(policy, principalsFor(policy, [K.stranger]), 'personal');
  const check = await citeCheck(c, pass, `${ID.founders} mem_0000000000000099`);
  assert.deepEqual(check.citations.map((x) => x.status), ['missing', 'missing']);
  const seen = JSON.stringify([await buildIndex(c, pass), await getItems(c, pass, 'secret merger')]);
  assert.ok(!seen.includes('Secret') && !seen.includes(ID.founders));
});

test('P13: ceiling casing normalises; unknown ceilings throw', () => {
  assert.equal(passFor(policy, ['founder'], 'TEAM').ceiling, 'team');
  assert.throws(() => passFor(policy, ['founder'], 'everything'));
});

test('P14: concurrent calls each resolve their own pass', async () => {
  const c = await ctx();
  let n = 0;
  const passes = [passFor(policy, ['founder'], 'personal'), passFor(policy, [`guest:${K.stranger}`], 'personal')];
  const resolve = async () => { const i = n++; await new Promise((r) => setTimeout(r, i === 0 ? 30 : 0)); return passes[i]; };
  const [a, b] = await Promise.all([handleMessage(c, 'x', msg('cb_index', 1), { resolve }), handleMessage(c, 'x', msg('cb_index', 2), { resolve })]);
  assert.deepEqual([JSON.parse(a.result.content[0].text).count, JSON.parse(b.result.content[0].text).count], [6, 1]);
});

test('F8: a pass carries issuedAt and requireFresh refuses a stale or foreign one', () => {
  const pass = passFor(policy, ['founder'], 'team');
  assert.equal(requireFresh(pass, 10_000), pass);
  assert.throws(() => requireFresh(pass, 10_000, pass.issuedAt + 10_001), /stale/);
  assert.throws(() => requireFresh(pass, 10_000, pass.issuedAt - 1), /stale/);
  assert.throws(() => requireFresh({ ...pass }, 10_000), /unresolved/);
  assert.throws(() => requireFresh(pass, undefined), /stale/);
});
