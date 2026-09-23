import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  biTemporal,
  isPlainObject,
  normalizeProvenance,
  optionalString,
  requiredString,
} from './kernel.mjs';
import { safeDataPath } from './safe-path.mjs';

test('safeDataPath refuses escapes and accepts nested relatives', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-kernel-'));
  assert.throws(() => safeDataPath(dataDir, ''), /refused unsafe data path/);
  assert.throws(() => safeDataPath(dataDir, '/etc/passwd'), /refused unsafe data path/);
  assert.throws(() => safeDataPath(dataDir, '../../etc/passwd'), /refused unsafe data path/);
  assert.throws(() => safeDataPath(dataDir, 'a/../../b'), /refused unsafe data path/);

  const resolved = safeDataPath(dataDir, path.join('company', 'BusinessUnit', 'bunit_deadbeef.json'));
  assert.equal(path.dirname(path.dirname(path.dirname(resolved))), dataDir);
});

test('provenance is closed and defaults deliberate', () => {
  assert.deepEqual(normalizeProvenance({ surface: 'company-runtime' }), {
    surface: 'company-runtime',
    lane: 'deliberate',
  });
  assert.throws(() => normalizeProvenance({ lane: 'deliberate' }), /surface is required/);
  assert.throws(
    () => normalizeProvenance({ surface: 'x', lane: 'nope' }),
    /invalid provenance.lane/,
  );
});

test('biTemporal normalizes event, validity, and ingestion times', () => {
  const now = () => new Date('2026-09-23T10:00:00.000Z');
  const temporal = biTemporal({ eventAt: '2026-09-20' }, now);
  assert.deepEqual(temporal, {
    eventAt: '2026-09-20T00:00:00.000Z',
    validFrom: '2026-09-20T00:00:00.000Z',
    ingestedAt: '2026-09-23T10:00:00.000Z',
  });
  assert.throws(() => biTemporal({ eventAt: 'not-a-date' }, now), /must be a valid date/);
});

test('string helpers keep their substrate semantics', () => {
  assert.equal(optionalString('  x  '), 'x');
  assert.equal(optionalString('   '), undefined);
  assert.equal(optionalString(null), undefined);
  assert.equal(requiredString(' x ', 'field'), 'x');
  assert.throws(() => requiredString('  ', 'field'), /field is required/);
  assert.equal(isPlainObject({}), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
});
