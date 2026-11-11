import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { proposeLocked } from './curation.mjs';
import { optionalString, requiredString } from './kernel.mjs';
import { runEval, showItem } from './memory.mjs';
import { canRead } from './policy.mjs';
import { TRIAGE_CLASSES } from './records.mjs';
import { safeDataPath } from './safe-path.mjs';
import { serializeByDataDir } from './store.mjs';
import { findLive, requireFounder, setTriage } from './trace.mjs';

// Three-way triage of a correction. A founder decides what a correction is:
//
//   exception  a one-off. Kept as context on the trace; never a rule.
//   test       a frozen eval case, appended to the holdout file.
//   system     a pending proposal to change a rulebook, skill or policy item.
//
// Only a founder sets the class (agents may suggest one: trace.suggestTriage).
// The class is set once; the trace is superseded to record it.
export const VERDICTS = Object.freeze(['SHIP', 'FIX', 'READY', 'NOT READY']);

// The holdout. Cases triage creates live here and nowhere else. The retro
// never trains, tunes or proposes against them: a rulebook edited until it
// passes its own test measures the edit, not the rulebook (the alias
// experiment: aliases written to fit the eval set lifted recall on that set
// and not on unseen queries). Append-only; no MCP tool and no agent skill
// reads it; `cb eval --file` refuses it; reading is founder-only.
export function holdoutFile(ctx) {
  return safeDataPath(ctx.dataDir, path.join('evals', 'holdout.jsonl'));
}

export function triage(ctx, principal, id, cls, options = {}) {
  return serializeByDataDir(ctx.dataDir, async () => {
    requireFounder(ctx, principal, 'triages a correction');
    if (!TRIAGE_CLASSES.includes(cls)) throw new Error(`class must be one of: ${TRIAGE_CLASSES.join(', ')}`);
    const trace = await findLive(ctx, principal, id);
    if (trace.triage) throw new Error(`${trace.id} is already triaged as ${trace.triage.class}`);
    const note = optionalString(options.note);
    if (cls !== 'test' && !note) throw new Error(`a ${cls} triage needs --note (the founder's words)`);
    if (cls === 'exception') return setTriage(ctx, principal, trace.id, { class: cls, note });
    if (cls === 'test') {
      const caseId = await appendHoldout(ctx, principal, trace, options, note);
      return setTriage(ctx, principal, trace.id, { class: cls, note: note ?? null, caseId });
    }
    const proposal = await systemProposal(ctx, principal, trace, options, note);
    return setTriage(ctx, principal, trace.id, { class: cls, note, proposalId: proposal.id });
  });
}

async function appendHoldout(ctx, principal, trace, options, note) {
  let testCase;
  if (options.query !== undefined) {
    const expect = [options.expect].flat().filter((entry) => typeof entry === 'string' && entry);
    if (expect.length === 0) throw new Error('a query case needs --expect <item id>');
    for (const entry of expect) {
      await showItem(ctx, principal, entry).catch(() => {
        throw new Error(`expected item does not resolve in your grant: ${entry}`);
      });
    }
    testCase = { query: requiredString(options.query, 'query'), expect };
  } else if (options.draft !== undefined) {
    const verdict = requiredString(options.verdict, 'verdict').toUpperCase();
    if (!VERDICTS.includes(verdict)) throw new Error(`verdict must be one of: ${VERDICTS.join(', ')}`);
    testCase = { draft: requiredString(options.draft, 'draft'), verdict };
  } else {
    throw new Error('a test needs --query <q> --expect <id>... or --draft <text> --verdict <SHIP|FIX|READY|NOT READY>');
  }
  const caseId = `case_${createHash('sha256').update(JSON.stringify([trace.proposalId, testCase])).digest('hex').slice(0, 16)}`;
  const file = holdoutFile(ctx);
  if ((await readLines(file)).some((row) => row.id === caseId)) return caseId;
  const line = {
    id: caseId,
    at: new Date().toISOString(),
    trace: trace.id,
    label: trace.label,
    ...(trace.owner ? { owner: trace.owner } : {}),
    by: principal,
    ...(note ? { note } : {}),
    case: testCase,
  };
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(line)}\n`);
  return caseId;
}

// A founder-written, pending proposal. The founder still approves it through
// the usual digest; triage only queues it. Target = the live item to supersede.
async function systemProposal(ctx, principal, trace, options, note) {
  const target = optionalString(options.target);
  const targetItem = target ? await showItem(ctx, principal, target) : null;
  // triage already holds the per-dataDir lock
  return proposeLocked(ctx, principal, {
    label: targetItem ? targetItem.label : trace.label,
    title: optionalString(options.title) ?? `System change from correction: ${trace.subject}`.slice(0, 120),
    quote: note,
    source: `triage of ${trace.id}`,
    ...(target ? { supersedes: target } : {}),
    ...(optionalString(options.body) ? { body: options.body } : {}),
    ...(trace.label === 'personal' ? { owner: principal } : {}),
  }, {});
}

async function readLines(file) {
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const raw of text.split('\n').filter((line) => line.trim())) {
    try {
      rows.push(JSON.parse(raw));
    } catch {
      // a torn line is skipped, never repaired: the file is append-only
    }
  }
  return rows;
}

// Founders only; each case is filtered by its own label.
export async function listHoldout(ctx, principal) {
  requireFounder(ctx, principal, 'reads the holdout');
  const rows = (await readLines(holdoutFile(ctx))).filter((row) => canRead(ctx.policy, principal, row.label, row.owner));
  return { principal, count: rows.length, cases: rows };
}

// Runs the query cases against the founder's grant. Verdict cases are for the
// critic and are listed, not run. The result is never written to the eval
// history: a number that can be compared to a training number is a number
// somebody will optimize.
export async function runHoldout(ctx, principal) {
  const { cases } = await listHoldout(ctx, principal);
  const queries = cases.filter((row) => row.case.query);
  const report = queries.length
    ? await runEval(ctx, principal, queries.map((row) => ({ query: row.case.query, expect: row.case.expect })))
    : null;
  return { principal, queryCases: queries.length, draftCases: cases.length - queries.length, report };
}

// Same file by identity, not by spelling: realpath, then device and inode
// (catches case-insensitive filesystems, symlinks and hard links). If the
// holdout does not exist yet there is nothing to leak.
export async function isHoldoutPath(ctx, file) {
  const holdout = holdoutFile(ctx);
  if (path.resolve(file) === path.resolve(holdout)) return true;
  const [a, b] = await Promise.all([fs.stat(file).catch(() => null), fs.stat(holdout).catch(() => null)]);
  return Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
}
