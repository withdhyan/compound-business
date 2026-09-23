import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The miner: read-only scan of configured history sources for candidate ideas.
// Two modes:
//   inbox  — every non-empty line in the file is a candidate (for ideas.md,
//            inbox.md, ideation.md, or any file the founder points at)
//   marker — only lines carrying an idea marker (for notes, docs, journals,
//            and chat histories)
// `.jsonl` files are read as user-authored text: history lines (`display`,
// `text`, `prompt`) or user messages (`type`/`role: user`). Tool calls,
// assistant turns, and malformed lines are skipped.
// It never writes to a source, never reaches the network, and never judges —
// evaluation is a separate pass. Statements are deduped against existing ideas
// and within the batch.
const INBOX_BASENAMES = ['ideas.md', 'inbox.md', 'ideation.md', 'ideas.txt'];

const MARKERS = [
  'idea:',
  'what if',
  'maybe we',
  'could we',
  'should we',
  'someday',
  'opportunity:',
  'note to self',
  'we could build',
  'worth building',
];

const DEFAULT_IGNORE = ['.git', 'node_modules', 'data', '.DS_Store'];
const DEFAULT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export async function mineSources(options = {}) {
  const sources = Array.isArray(options.sources) ? options.sources : [];
  const ignore = new Set(options.ignore ?? DEFAULT_IGNORE);
  const limit = positiveLimit(options.limit);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const existing = new Set(
    (options.existingStatements ?? []).map(normalizeStatement),
  );
  const seen = new Set();
  const candidates = [];

  for (const source of sources) {
    const sourcePath = expandHome(source.path);
    const files = await collectFiles(sourcePath, ignore, maxFileBytes);
    for (const file of files) {
      const mode = source.mode ?? inferMode(file);
      const isJsonl = file.endsWith('.jsonl');
      const raw = await fs.readFile(file, 'utf8');
      const lines = raw.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const text = isJsonl ? jsonlLineToText(lines[index]) : lines[index];
        if (text === null) continue;
        for (const embedded of text.split(/\r?\n/)) {
          const statement = candidateFromLine(embedded, mode);
          if (!statement) continue;
          const key = normalizeStatement(statement);
          if (!key || existing.has(key) || seen.has(key)) continue;
          seen.add(key);
          candidates.push({ statement, source: `${file}:${index + 1}` });
          if (candidates.length >= limit) {
            return candidates;
          }
        }
      }
    }
  }

  return candidates;
}

export function extractCandidates(text, options = {}) {
  const mode = options.mode ?? 'marker';
  const out = [];
  const lines = String(text ?? '').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const statement = candidateFromLine(lines[index], mode);
    if (statement) out.push({ statement, line: index + 1 });
  }
  return out;
}

export function normalizeStatement(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function candidateFromLine(raw, mode) {
  const cleaned = cleanStatement(raw, mode);
  if (!cleaned) return null;
  if (mode === 'marker' && !hasMarker(String(raw ?? '').toLowerCase())) return null;
  return cleaned;
}

function hasMarker(lowered) {
  return MARKERS.some((marker) => lowered.includes(marker));
}

function jsonlLineToText(line) {
  const trimmed = String(line ?? '').trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed === 'string') return parsed;
  if (!parsed || typeof parsed !== 'object') return null;
  if (typeof parsed.display === 'string') return parsed.display;
  if (typeof parsed.text === 'string') return parsed.text;
  if (typeof parsed.prompt === 'string') return parsed.prompt;
  const role = parsed.role ?? parsed.type;
  if (role !== 'user') return null;
  const content = parsed.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const texts = content
      .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text);
    return texts.length > 0 ? texts.join('\n') : null;
  }
  return null;
}

function cleanStatement(raw, mode = 'marker') {
  let value = String(raw ?? '').trim();
  if (!value || value.startsWith('#')) return null;
  value = value
    .replace(/^[-*+]\s+/, '')
    .replace(/^\[[ x]\]\s+/i, '')
    .replace(/^\d+[.)]\s+/, '')
    .trim();
  value = value
    .replace(/^(idea|opportunity|note to self|note)\s*:\s*/i, '')
    .trim();
  if (mode === 'marker') {
    value = value
      .replace(/^(someday|what if|maybe we|could we|should we|we could build|worth building)\s*:?\s*/i, '')
      .trim();
  }
  value = value.replace(/\s+/g, ' ').trim();
  if (value.length < 12 || value.length > 240) return null;
  if (/^https?:\/\//i.test(value)) return null;
  return value;
}

function inferMode(sourcePath) {
  const base = path.basename(sourcePath).toLowerCase();
  return INBOX_BASENAMES.includes(base) ? 'inbox' : 'marker';
}

function expandHome(value) {
  const raw = String(value ?? '').trim();
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

async function collectFiles(target, ignore, maxFileBytes) {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) return [];

  const files = [];
  const entries = await fs.readdir(target, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, ignore, maxFileBytes)));
    } else if (entry.isFile() && /\.(md|txt|mdx|jsonl)$/i.test(entry.name)) {
      const fileStat = await fs.stat(full);
      if (fileStat.size <= maxFileBytes) files.push(full);
    }
  }
  return files;
}

function positiveLimit(value) {
  if (value === undefined || value === null) return 50;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('mine limit must be a positive integer');
  }
  return value;
}
