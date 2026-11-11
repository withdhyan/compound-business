import { createInterface } from 'node:readline';

import { propose } from './curation.mjs';
import { listTraces, showTrace, suggestTriage } from './trace.mjs';
import { isPass } from './audience.mjs';
import { buildIndex, citeCheck, getItems, showItem } from './memory.mjs';

// A minimal stdio MCP server (newline-delimited JSON-RPC 2.0) over the
// read surface (get, show, cite-check, traces) plus two writes: cb_propose, which
// only queues a pending entry no reader can see, and cb_trace_suggest, a note
// on a trace that sets nothing. The principal is bound when the
// server starts, or `launch.resolve()` returns the current audience pass on
// every call (see audience.mjs) (`cb mcp --as <principal>`); no tool takes a principal, a
// trust flag or a founder-approval flag, so an agent cannot widen its grant,
// promote untrusted content, or approve anything.
const TOOLS = [
  {
    name: 'cb_index',
    description: 'List every item you may read: id, label, title, summary, updated, superseded. No bodies. Start here when the store is small (200 visible items or fewer), pick ids, then cb_show them.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'cb_get',
    description: 'Search the company memory within your grant. Returns matching items with ids to cite.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer' } },
      required: ['query'],
    },
  },
  {
    name: 'cb_show',
    description: 'Read one item by id, within your grant.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'cb_cite_check',
    description: 'Check the item ids cited in a text: flags missing and superseded ones.',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  {
    name: 'cb_trace_list',
    description: 'List the decision traces you may read: what was proposed, edited, decided and what happened after. Read-only. A trace marked triage=exception is context, never a rule; only triage=system traces justify a rule change.',
    inputSchema: { type: 'object', properties: { untriaged: { type: 'boolean' } } },
  },
  {
    name: 'cb_trace_show',
    description: 'Read one decision trace by trace id or proposal id, within your grant. Read-only.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'cb_trace_suggest',
    description: 'Suggest how a founder should triage a correction: exception (one-off context), test (frozen eval case) or system (change a rulebook, skill or policy). A suggestion is a note only; a founder sets the class.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, class: { type: 'string', enum: ['exception', 'test', 'system'] }, note: { type: 'string' } },
      required: ['id', 'class'],
    },
  },
  {
    name: 'cb_propose',
    description: 'Add `aliases` (alternative search words) if the item is hard to find by its own words. Propose a memory entry or an edit (supersedes). It stays pending until a founder approves; nothing you propose is readable meanwhile.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' }, title: { type: 'string' }, quote: { type: 'string' }, source: { type: 'string' },
        summary: { type: 'string' }, body: { type: 'string' }, supersedes: { type: 'string' },
        aliases: { type: 'array', items: { type: 'string' } },
        evidence: { type: 'array', items: { type: 'string' } },
      },
      required: ['label', 'title', 'quote', 'source'],
    },
  },
];

// Under an audience pass only the read tools run; propose and trace writes
// belong to one named principal.
const PASS_TOOLS = new Set(['cb_index', 'cb_get', 'cb_show', 'cb_cite_check']);

async function runTool(ctx, principal, name, args = {}, launch = {}) {
  if (name === 'cb_index') {
    const { items } = await buildIndex(ctx, principal);
    return {
      count: items.length,
      items: items.map((item) => ({
        id: item.id,
        label: item.label,
        title: item.title,
        summary: item.summary,
        updated: item.updated,
        superseded: item.superseded,
        ...(item.replacement ? { replacement: item.replacement.id } : {}),
        ...(item.trust ? { trust: item.trust } : {}),
      })),
    };
  }
  if (name === 'cb_get') return getItems(ctx, principal, args.query, { limit: args.limit });
  if (name === 'cb_show') return showItem(ctx, principal, args.id);
  if (name === 'cb_cite_check') return citeCheck(ctx, principal, String(args.text ?? ''));
  if (name === 'cb_trace_list') return listTraces(ctx, principal, { untriaged: args.untriaged === true });
  if (name === 'cb_trace_show') return showTrace(ctx, principal, args.id);
  if (name === 'cb_trace_suggest') {
    const row = await suggestTriage(ctx, principal, args.id, args.class, args.note);
    return { id: row.id, suggestions: row.suggestions };
  }
  if (name === 'cb_propose') {
    const { label, title, quote, source, summary, body, supersedes, evidence, aliases } = args;
    const row = await propose(ctx, principal, { label, title, quote, source, summary, body, supersedes, evidence, aliases }, { untrustedLaunch: launch.untrusted === true });
    return { id: row.id, status: row.status, label: row.label };
  }
  throw new Error(`unknown tool: ${name}`);
}

export async function handleMessage(ctx, principal, message, launch = {}) {
  const reply = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  if (message.id === undefined || message.id === null) return null;
  switch (message.method) {
    case 'initialize':
      return reply({
        protocolVersion: message.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'cb', version: '0.1.0' },
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      try {
        // A resolver is asked on every call; no answer is no access.
        const who = launch.resolve ? await launch.resolve() : principal;
        if (typeof who !== 'string' && !isPass(who)) throw new Error('audience unresolved');
        if (isPass(who) && !PASS_TOOLS.has(message.params?.name)) throw new Error(`tool not available to an audience: ${message.params?.name}`);
        const out = await runTool(ctx, who, message.params?.name, message.params?.arguments, launch);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out) }] });
      } catch (error) {
        return reply({ isError: true, content: [{ type: 'text', text: error.message }] });
      }
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } };
  }
}

export async function serve(ctx, principal, input = process.stdin, output = process.stdout, launch = {}) {
  const lines = createInterface({ input });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    try {
      response = await handleMessage(ctx, principal, JSON.parse(line), launch);
    } catch {
      response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}
