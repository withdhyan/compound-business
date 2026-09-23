#!/usr/bin/env node
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mineSources } from './mine.mjs';
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
//   node runtime/cli.mjs mine [--config sources.json] [--limit n] [--json]

export async function addIdea(store, options) {
  const statement = required(options.statement, 'statement');
  if (await findIdea(store, statement)) {
    throw new Error(`idea already recorded: ${statement}`);
  }
  const idea = buildBusinessIdea({
    statement,
    ...(options.source ? { source: options.source } : {}),
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
    }, () => new Date());
    await store.writeRecord(idea);
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

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const dataDir = path.resolve(
    typeof flags.data === 'string' ? flags.data : process.env.CB_DATA_DIR ?? 'data',
  );
  const store = createCompanyStore({ dataDir });
  const [group, verb, ...rest] = positionals;
  const json = flags.json === true;
  const print = (value) => {
    if (json) {
      console.log(JSON.stringify(value, null, 2));
      return;
    }
    console.log(format(value));
  };

  if (group === 'idea') {
    if (verb === 'add') {
      const idea = await addIdea(store, {
        statement: rest.join(' '),
        source: typeof flags.source === 'string' ? flags.source : undefined,
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
    }));
    return;
  }

  throw new Error(
    'usage: cli.mjs [--data <dir>] idea add|list|show|amplify|evaluate|decide|advance | mine',
  );
}

function format(value) {
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
