import { createInterface } from 'node:readline';

import { propose } from './curation.mjs';
import { citeCheck, getItems, showItem } from './memory.mjs';

// A minimal stdio MCP server (newline-delimited JSON-RPC 2.0) over the
// read surface (get, show, cite-check) plus one write: cb_propose, which only
// queues a pending entry no reader can see. The principal is bound when the
// server starts (`cb mcp --as <principal>`); no tool takes a principal, a
// trust flag or a founder-approval flag, so an agent cannot widen its grant,
// promote untrusted content, or approve anything.
const TOOLS = [
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

async function runTool(ctx, principal, name, args = {}, launch = {}) {
  if (name === 'cb_get') return getItems(ctx, principal, args.query, { limit: args.limit });
  if (name === 'cb_show') return showItem(ctx, principal, args.id);
  if (name === 'cb_cite_check') return citeCheck(ctx, principal, String(args.text ?? ''));
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
        const out = await runTool(ctx, principal, message.params?.name, message.params?.arguments, launch);
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
