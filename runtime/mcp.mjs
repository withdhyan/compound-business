import { createInterface } from 'node:readline';

import { citeCheck, getItems, showItem } from './memory.mjs';

// A minimal stdio MCP server (newline-delimited JSON-RPC 2.0) over the
// read-only surface: get, show, cite-check. The principal is bound when the
// server starts (`cb mcp --as <principal>`); no tool takes a principal, so a
// caller cannot widen its own grant. There are no write tools.
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
];

async function runTool(ctx, principal, name, args = {}) {
  if (name === 'cb_get') return getItems(ctx, principal, args.query, { limit: args.limit });
  if (name === 'cb_show') return showItem(ctx, principal, args.id);
  if (name === 'cb_cite_check') return citeCheck(ctx, principal, String(args.text ?? ''));
  throw new Error(`unknown tool: ${name}`);
}

export async function handleMessage(ctx, principal, message) {
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
        const out = await runTool(ctx, principal, message.params?.name, message.params?.arguments);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out) }] });
      } catch (error) {
        return reply({ isError: true, content: [{ type: 'text', text: error.message }] });
      }
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `method not found: ${message.method}` } };
  }
}

export async function serve(ctx, principal, input = process.stdin, output = process.stdout) {
  const lines = createInterface({ input });
  for await (const line of lines) {
    if (!line.trim()) continue;
    let response;
    try {
      response = await handleMessage(ctx, principal, JSON.parse(line));
    } catch {
      response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } };
    }
    if (response) output.write(`${JSON.stringify(response)}\n`);
  }
}
