#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { approve, digest, listPending, propose } from './curation.mjs';
import { evalTrend, recordEval } from './evals.mjs';
import { addRecord, countedTotal, listLedger, updateRecord } from './ledger.mjs';
import { serve } from './mcp.mjs';
import { buildIndex, citeCheck, getItems, runEval, showItem } from './memory.mjs';
import { mineSources } from './mine.mjs';
import { loadPolicy } from './policy.mjs';
import {
  buildBusinessIdea,
  normalizeIdeaStatus,
} from './records.mjs';
import { createCompanyStore } from './store.mjs';

// The creator loop's command surface. Every command writes through the store;
// nothing here reaches the network. Amplification and evaluation are produced
// by the agent (see skills/amplify/SKILL.md) and handed in as JSON.
//
//   node runtime/cli.mjs [--data <dir>] idea add "<statement>" [--source <s>]
//   node runtime/cli.mjs idea list [--status <s>] [--json]
//   node runtime/cli.mjs idea show <id|statement> [--json]
//   node runtime/cli.mjs idea amplify <id> --file <variants.json>
//   node runtime/cli.mjs idea evaluate <id> --file <eval.json>
//   node runtime/cli.mjs idea decide <id> --variant "<title>" [--variant ...] [--note <s>]
//   node runtime/cli.mjs idea advance <id> --status building|shipped|dropped
//   node runtime/cli.mjs mine [--config sources.json] [--limit n] [--label <l>] [--json]
//
// Memory layer (every read names its principal with --as; labels and grants
// come from <data>/policy.json, files from <data>/memory or --memory <dir>):
//   node runtime/cli.mjs index --as <p>
//   node runtime/cli.mjs get --as <p> <query> [--limit n]
//   node runtime/cli.mjs show --as <p> <id>
//   node runtime/cli.mjs cite-check --as <p> <file|->        (exit 1 on a bad cite)
//   node runtime/cli.mjs propose --as <p> --label <l> --title <t> --quote <q> --source <s>
//                      [--body <new text>] [--supersedes <id>] [--evidence <e>]... [--trust untrusted --founder-approved]
//   node runtime/cli.mjs pending --as <founder>
//   node runtime/cli.mjs approve --as <founder> <id>...
//   node runtime/cli.mjs digest --as <founder>               (pending batch: label, source, quote, change)
//   node runtime/cli.mjs eval --as <p> --file tasks.json [--min <recall>] [--role <r>] [--record]
//   node runtime/cli.mjs eval-trend --as <founder> [--role <r>]
//   node runtime/cli.mjs record add|update|list measure|receipt
//   node runtime/cli.mjs mcp --as <p>                         (stdio MCP, read-only)

export async function addIdea(store, options) {
  const statement = required(options.statement, 'statement');
  if (await findIdea(store, statement)) {
    throw new Error(`idea already recorded: ${statement}`);
  }
  const idea = buildBusinessIdea({
    statement,
    ...(options.source ? { source: options.source } : {}),
    ...(options.label ? { label: options.label } : {}),
  }, () => new Date());
  await store.writeRecord(idea);
  return idea;
}

export async function listIdeas(store, options = {}) {
  const ideas = (await store.liveRecords('BusinessIdea'))
    .filter((idea) => !options.status || idea.status === options.status);
  return ideas.sort(
    (left, right) =>
      (left.evaluation?.verdict ?? 'zzz').localeCompare(right.evaluation?.verdict ?? 'zzz') ||
      left.statement.localeCompare(right.statement),
  );
}

export async function showIdea(store, ref) {
  const idea = await findIdea(store, ref);
  if (!idea) throw new Error(`no idea: ${ref}`);
  return idea;
}

export async function amplifyIdea(store, ref, variants) {
  const idea = await mustFindIdea(store, ref);
  if (!Array.isArray(variants) || variants.length === 0) {
    throw new Error('amplification needs a non-empty variants array');
  }
  const successor = successorFor(idea, {
    status: 'amplified',
    variants,
  });
  await store.supersedeRecord(idea.id, successor);
  return successor;
}

export async function evaluateIdea(store, ref, evaluation) {
  const idea = await mustFindIdea(store, ref);
  const successor = successorFor(idea, { evaluation });
  await store.supersedeRecord(idea.id, successor);
  return successor;
}

export async function decideIdea(store, ref, options) {
  const idea = await mustFindIdea(store, ref);
  const chosenVariants = Array.isArray(options.variant)
    ? options.variant
    : [options.variant].filter(Boolean);
  if (chosenVariants.length === 0) {
    throw new Error('decide needs at least one --variant');
  }
  const successor = successorFor(idea, {
    status: 'decided',
    chosenVariants,
    ...(options.note ? { decisionNote: options.note } : {}),
  });
  await store.supersedeRecord(idea.id, successor);
  return successor;
}

export async function advanceIdea(store, ref, options) {
  const idea = await mustFindIdea(store, ref);
  const status = normalizeIdeaStatus(options.status);
  const successor = successorFor(idea, { status });
  await store.supersedeRecord(idea.id, successor);
  return successor;
}

export async function mineIntoStore(store, options = {}) {
  const config = await readMineConfig(options.config);
  const existing = await store.liveRecords('BusinessIdea');
  const existingStatements = existing.map((idea) => idea.statement);
  const candidates = await mineSources({
    sources: config.sources,
    ignore: config.ignore,
    limit: options.limit ?? config.limit,
    existingStatements,
  });
  const created = [];
  for (const candidate of candidates) {
    const idea = buildBusinessIdea({
      statement: candidate.statement,
      source: candidate.source,
      ...(options.label ? { label: options.label } : {}),
    }, () => new Date());
    if (!options.dryRun) {
      await store.writeRecord(idea);
    }
    created.push(idea);
  }
  return created;
}

export async function findIdea(store, ref) {
  const value = required(ref, 'ref');
  if (/^bidea_[0-9a-f]{24}$/.test(value)) {
    const record = await store.readRecord(value);
    if (!record || record.kind !== 'BusinessIdea') return null;
    return record.validTo || record.supersededById ? null : record;
  }
  const target = normalizeRef(value);
  const ideas = await store.liveRecords('BusinessIdea');
  return (
    ideas.find((idea) => idea.id === value) ??
    ideas.find((idea) => normalizeRef(idea.statement) === target) ??
    ideas.find((idea) => normalizeRef(idea.statement).includes(target)) ??
    null
  );
}

function successorFor(idea, changes) {
  const body = {
    statement: idea.statement,
    ...(idea.source ? { source: idea.source } : {}),
    ...(idea.label ? { label: idea.label } : {}),
    status: changes.status ?? idea.status,
    variants: changes.variants ?? idea.variants,
    chosenVariants: changes.chosenVariants ?? idea.chosenVariants,
    ...(changes.decisionNote ?? idea.decisionNote
      ? { decisionNote: changes.decisionNote ?? idea.decisionNote }
      : {}),
    ...(changes.evaluation ?? idea.evaluation
      ? { evaluation: changes.evaluation ?? idea.evaluation }
      : {}),
    dedupeKey: idea.dedupeKey,
    supersedes: idea.id,
    eventAt: new Date().toISOString(),
  };
  return buildBusinessIdea(body, () => new Date());
}

async function mustFindIdea(store, ref) {
  const idea = await findIdea(store, ref);
  if (!idea) throw new Error(`no idea: ${ref}`);
  return idea;
}

async function readMineConfig(configPath) {
  const file = path.resolve(configPath ?? 'sources.json');
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`mine needs a config file (${file}); see runtime/sources.example.json`);
    }
    throw error;
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.sources) || parsed.sources.length === 0) {
    throw new Error(`mine config needs a non-empty sources array: ${file}`);
  }
  return parsed;
}

function normalizeRef(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function required(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

// ---- argv surface ---------------------------------------------------------

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    const value = argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')
      ? argv[index + 1]
      : true;
    if (value !== true) index += 1;
    if (flags[name] === undefined) {
      flags[name] = value;
    } else if (Array.isArray(flags[name])) {
      flags[name].push(value);
    } else {
      flags[name] = [flags[name], value];
    }
  }
  return { positionals, flags };
}

async function readJsonFile(file, label) {
  if (typeof file !== 'string' || file.trim() === '') {
    throw new Error(`${label} need a --file <path>`);
  }
  const raw = await fs.readFile(path.resolve(file), 'utf8');
  const parsed = JSON.parse(raw);
  if (label === 'variants') {
    return Array.isArray(parsed) ? parsed : parsed.variants;
  }
  return parsed;
}

// Memory-layer context: policy (labels, grants, founders, stages), the store
// built on it, and the markdown directories.
export async function buildContext(flags = {}, env = process.env) {
  const dataDir = path.resolve(
    typeof flags.data === 'string' ? flags.data : env.CB_DATA_DIR ?? 'data',
  );
  const policy = await loadPolicy(
    typeof flags.policy === 'string' ? flags.policy : path.join(dataDir, 'policy.json'),
    typeof flags.policy === 'string',
  );
  const memory = [flags.memory].flat().filter((entry) => typeof entry === 'string');
  const dirs = (memory.length ? memory : [path.join(dataDir, 'memory')]).map((dir) => path.resolve(dir));
  const names = dirs.map((dir) => path.basename(dir));
  if (new Set(names).size !== names.length) {
    throw new Error('memory directories must have distinct names (ids and shares are built from them)');
  }
  return {
    dataDir,
    policy,
    store: createCompanyStore({ dataDir, policy }),
    memoryDirs: dirs,
  };
}

function principalFrom(flags) {
  if (typeof flags.as !== 'string' || flags.as.trim() === '') {
    throw new Error('--as <principal> is required');
  }
  return flags.as;
}

// Runs one memory-layer command. Returns { value, exitCode } or null when the
// command is not a memory command.
export async function executeMemoryCommand(group, rest, flags, ctx) {
  const as = () => principalFrom(flags);
  switch (group) {
    case 'index':
      return { value: await buildIndex(ctx, as()), exitCode: 0 };
    case 'get':
      return {
        value: await getItems(ctx, as(), rest.join(' '), {
          limit: flags.limit ? Number(flags.limit) : undefined,
        }),
        exitCode: 0,
      };
    case 'show':
      return { value: await showItem(ctx, as(), rest[0]), exitCode: 0 };
    case 'cite-check': {
      const source = required(rest[0], 'file');
      const text = source === '-' ? await readStdin() : await fs.readFile(path.resolve(source), 'utf8');
      const report = await citeCheck(ctx, as(), text);
      return { value: report, exitCode: report.ok ? 0 : 1 };
    }
    case 'propose':
      return {
        value: await propose(ctx, as(), {
          label: flags.label,
          title: flags.title,
          quote: flags.quote,
          source: flags.source,
          owner: flags.owner,
          summary: flags.summary,
          body: typeof flags.body === 'string' ? flags.body : undefined,
          supersedes: flags.supersedes,
          evidence: flags.evidence === true ? undefined : flags.evidence,
          trust: flags.trust,
          founderApproved: flags['founder-approved'] === true,
        }),
        exitCode: 0,
      };
    case 'pending':
      return { value: await listPending(ctx, as()), exitCode: 0 };
    case 'digest':
      return { value: await digest(ctx, as()), exitCode: 0 };
    case 'approve':
      return { value: await approve(ctx, as(), rest), exitCode: 0 };
    case 'eval-trend':
      return { value: await evalTrend(ctx, as(), { role: typeof flags.role === 'string' ? flags.role : undefined }), exitCode: 0 };
    case 'record':
      return { value: await executeRecordCommand(rest, flags, ctx), exitCode: 0 };
    case 'eval': {
      const tasks = await readJsonFile(flags.file, 'tasks');
      const report = await runEval(ctx, as(), Array.isArray(tasks) ? tasks : tasks.tasks);
      if (flags.record === true) await recordEval(ctx, report, { role: typeof flags.role === 'string' ? flags.role : undefined });
      const min = flags.min === undefined ? 0 : Number(flags.min);
      return { value: report, exitCode: report.recall >= min ? 0 : 1 };
    }
    default:
      return null;
  }
}

// Ledger records (measures, receipts): trusted-operator writes, like `idea`.
async function executeRecordCommand([verb, target], flags, ctx) {
  if (verb === 'add') {
    return addRecord(ctx.store, target, await readJsonFile(flags.file, 'record'), { label: flags.label });
  }
  if (verb === 'update') return updateRecord(ctx.store, target, await readJsonFile(flags.file, 'record'));
  if (verb === 'list') {
    const records = await listLedger(ctx.store, target);
    return { kind: target, records, ...(target === 'receipt' ? { totals: countedTotal(records) } : {}) };
  }
  throw new Error('usage: record add <measure|receipt> --file f.json --label <l> | record update <id> --file f.json | record list <measure|receipt>');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const ctx = await buildContext(flags);
  const store = ctx.store;
  const [group, verb, ...rest] = positionals;
  const json = flags.json === true;
  const print = (value) => {
    if (json) {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    console.log(format(value));
  };

  if (group === 'mcp') {
    await serve(ctx, principalFrom(flags));
    return;
  }
  const memory = await executeMemoryCommand(group, [verb, ...rest].filter((x) => x !== undefined), flags, ctx);
  if (memory) {
    print(memory.value);
    process.exitCode = memory.exitCode;
    return;
  }

  if (group === 'idea') {
    if (verb === 'add') {
      const idea = await addIdea(store, {
        statement: rest.join(' '),
        source: typeof flags.source === 'string' ? flags.source : undefined,
        label: typeof flags.label === 'string' ? flags.label : undefined,
      });
      print(idea);
      return;
    }
    if (verb === 'list') {
      print(await listIdeas(store, {
        status: typeof flags.status === 'string' ? flags.status : undefined,
      }));
      return;
    }
    if (verb === 'show') {
      print(await showIdea(store, rest.join(' ')));
      return;
    }
    if (verb === 'amplify') {
      print(await amplifyIdea(store, rest.join(' '), await readJsonFile(flags.file, 'variants')));
      return;
    }
    if (verb === 'evaluate') {
      print(await evaluateIdea(store, rest.join(' '), await readJsonFile(flags.file, 'evaluation')));
      return;
    }
    if (verb === 'decide') {
      print(await decideIdea(store, rest.join(' '), {
        variant: Array.isArray(flags.variant) ? flags.variant : [flags.variant].filter(Boolean),
        note: typeof flags.note === 'string' ? flags.note : undefined,
      }));
      return;
    }
    if (verb === 'advance') {
      print(await advanceIdea(store, rest.join(' '), { status: flags.status }));
      return;
    }
  }

  if (group === 'mine') {
    print(await mineIntoStore(store, {
      config: typeof flags.config === 'string' ? flags.config : undefined,
      limit: flags.limit ? Number(flags.limit) : undefined,
      dryRun: flags['dry-run'] === true,
      label: typeof flags.label === 'string' ? flags.label : undefined,
    }));
    return;
  }

  throw new Error(
    'usage: cli.mjs [--data <dir>] idea add|list|show|amplify|evaluate|decide|advance | mine | index|get|show|cite-check|propose|pending|digest|approve|eval|eval-trend|mcp --as <principal> | record add|update|list <principal>',
  );
}

function formatMemory(value) {
  const row = (item) =>
    `${item.id}  ${item.label}  ${item.path}\n  ${item.title}${item.summary ? ` - ${item.summary}` : ''} (${item.updated})` +
    (item.superseded
      ? `\n  SUPERSEDED${item.replacement ? ` by ${item.replacement.id} "${item.replacement.title}"` : ''}`
      : '') +
    (item.snippet ? `\n  > ${item.snippet}` : '');
  if (value.results) return value.results.length ? value.results.map(row).join('\n') : '(no match in your grant)';
  if (value.items) {
    const warnings = value.warnings.map((warning) => `warning: ${warning}`);
    return [...value.items.map(row), ...warnings].join('\n') || '(empty)';
  }
  if (value.citations) {
    const lines = value.citations.map(
      (c) => `line ${c.line}  ${c.id}  ${c.status}${c.replacement ? ` -> ${c.replacement}` : ''}`,
    );
    return [...lines, value.ok ? 'cite-check: ok' : 'cite-check: FAILED'].join('\n');
  }
  if (value.tasks) {
    const lines = value.tasks.map((t) => `${t.recall.toFixed(2)}  ${t.query}${t.missed.length ? `  missed: ${t.missed.join(' ')}` : ''}`);
    return [...lines, `recall ${value.recall.toFixed(3)} (${value.hits}/${value.expected})`].join('\n');
  }
  if (value.record) return `${value.id}  ${value.label}  ${value.path}\n${JSON.stringify(value.record, null, 2)}`;
  if (value.rows && value.count !== undefined) {
    if (value.count === 0) return 'nothing pending';
    const lines = value.rows.map((r) => [
      `${r.id}  ${r.label} · ${r.source} · "${r.quote}"${r.trust === 'untrusted' ? '  [UNTRUSTED, founder-vouched]' : ''}`,
      `  change: ${r.change}`,
      ...r.evidence.map((e) => `  evidence: ${e}`),
    ].join('\n'));
    return [...lines, `approve: cb approve --as ${value.principal} <id>...`].join('\n');
  }
  if (value.series) {
    const lines = value.series.map((r) => `${r.key.padEnd(14)} runs ${r.runs}  week-0 ${r.first.recall.toFixed(2)} -> now ${r.last.recall.toFixed(2)}  (${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(2)})`);
    return lines.length ? lines.join('\n') : '(no eval history)';
  }
  if (value.records) {
    const lines = value.records.map((r) => `${r.id}  ${r.label ?? '-'}  ${r.instrument ?? r.counterparty}${r.counted !== undefined ? (r.counted ? '  COUNTED' : '  not counted') : r.reportable ? '  reportable' : '  not reportable'}`);
    const t = value.totals ? [`counted ${value.totals.counted}  not counted ${value.totals.uncounted}`] : [];
    return [...lines, ...t].join('\n') || '(none)';
  }
  if (value.counterparty || value.instrument) return `${value.id}  ${value.label ?? '-'}  ${value.counterparty ?? value.instrument}`;
  if (value.approved) return `approved: ${value.approved.join(' ')}`;
  return null;
}

function format(value) {
  if (value && !Array.isArray(value) && typeof value === 'object') {
    const memory = formatMemory(value);
    if (memory !== null) return memory;
  }
  if (value && !Array.isArray(value) && typeof value === 'object' && value.body !== undefined) {
    return `${value.id}  ${value.label}  ${value.path}\n${value.body}`;
  }
  if (value && !Array.isArray(value) && value.status === 'pending') {
    return `pending ${value.id}  ${value.label}  ${value.title}`;
  }
  if (Array.isArray(value) && value[0]?.status === 'pending') {
    return value.map((p) => `${p.id}  ${p.label}  ${p.title}\n  source: ${p.source}\n  quote: ${p.quote}`).join('\n');
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '(none)';
    return value
      .map((item) => `${item.status.padEnd(10)} ${item.id}  ${item.statement}`)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    const lines = [`${value.status}  ${value.id}`, value.statement];
    if (value.source) lines.push(`source: ${value.source}`);
    if (value.evaluation) {
      lines.push(`verdict: ${value.evaluation.verdict}  ${JSON.stringify(value.evaluation.scores)}`);
    }
    for (const variant of value.variants ?? []) {
      lines.push(`- [${variant.angle}] ${variant.title}: ${variant.oneLiner}`);
    }
    if (value.chosenVariants?.length) lines.push(`chosen: ${value.chosenVariants.join(' | ')}`);
    return lines.join('\n');
  }
  return String(value);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`cb: ${error.message}`);
    process.exitCode = 1;
  });
}
