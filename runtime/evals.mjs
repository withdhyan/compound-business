import { promises as fs } from 'node:fs';
import path from 'node:path';

import { optionalString } from './kernel.mjs';
import { isFounderPrincipal } from './policy.mjs';
import { safeDataPath } from './safe-path.mjs';

// The scorecard trend. Each `cb eval --record` appends one aggregate line to
// <data>/evals/history.jsonl (no query text, no item ids), so the founder can
// read week-0 against week-N per role. The file is append-only by convention;
// the runtime never rewrites it.
function historyFile(ctx) {
  return safeDataPath(ctx.dataDir, path.join('evals', 'history.jsonl'));
}

export async function recordEval(ctx, report, options = {}) {
  const at = options.at ?? new Date().toISOString();
  if (Number.isNaN(Date.parse(at))) throw new Error('eval history needs an ISO timestamp');
  const role = optionalString(options.role);
  const line = {
    at,
    principal: report.principal,
    role: role ?? null,
    recall: report.recall,
    hits: report.hits,
    expected: report.expected,
    tasks: report.tasks.length,
  };
  const file = historyFile(ctx);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(line)}\n`);
  return line;
}

export async function evalTrend(ctx, principal, options = {}) {
  if (!isFounderPrincipal(principal, ctx.policy)) throw new Error('only a founder reads the eval trend');
  let text;
  try {
    text = await fs.readFile(historyFile(ctx), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { principal, series: [], skipped: 0 };
    throw error;
  }
  const groups = new Map();
  let skipped = 0;
  for (const raw of text.split('\n').filter((line) => line.trim())) {
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      skipped += 1;
      continue;
    }
    if (!Number.isFinite(row?.recall) || Number.isNaN(Date.parse(row.at))) {
      skipped += 1;
      continue;
    }
    const key = row.role ?? row.principal;
    if (options.role && key !== options.role) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const series = [...groups].map(([key, rows]) => {
    rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const point = (row) => ({ at: row.at, recall: row.recall });
    const first = rows[0];
    const last = rows[rows.length - 1];
    return { key, runs: rows.length, first: point(first), last: point(last), delta: last.recall - first.recall };
  });
  series.sort((a, b) => a.key.localeCompare(b.key));
  return { principal, series, skipped };
}
