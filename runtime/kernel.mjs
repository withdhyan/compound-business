const CAPTURE_LANES = Object.freeze(['deliberate', 'ambient']);

// Minimal kernel for the company runtime: the envelope and validation helpers
// the runtime needs, with no host dependencies. Extracted from K's substrate
// conventions; this repo is the canonical home from here on.

export function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function optionalString(value) {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

export function requiredString(value, label) {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function biTemporal(input, now) {
  const current = now instanceof Date ? now : now();
  const eventAt = toIso(input.eventAt ?? input.validFrom ?? current, 'eventAt');
  return {
    eventAt,
    validFrom: toIso(input.validFrom ?? eventAt, 'validFrom'),
    ingestedAt: toIso(input.ingestedAt ?? current, 'ingestedAt'),
  };
}

export function normalizeProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') {
    throw new Error('provenance is required');
  }
  const surface = requiredString(provenance.surface, 'provenance.surface');
  const lane = provenance.lane ?? 'deliberate';
  if (!CAPTURE_LANES.includes(lane)) {
    throw new Error(`invalid provenance.lane: ${lane}`);
  }
  return { surface, lane };
}

function toIso(value, label) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return date.toISOString();
}
