import {
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

// Refuses any relative path that escapes the data root, resolves through
// symlinks on the existing ancestors, and is the only way the store turns a
// relative name into a file path. Model-supplied strings never reach here as
// paths: record ids are hashes and kind directories are closed enums.
export function safeDataPath(dataDir, relPath) {
  const root = path.resolve(dataDir);
  const rel = String(relPath ?? '');
  if (
    !rel ||
    path.isAbsolute(rel) ||
    path.win32.isAbsolute(rel) ||
    rel.split(/[\\/]+/).includes('..')
  ) {
    throw new Error(`refused unsafe data path: ${relPath}`);
  }

  const resolved = path.resolve(root, rel);
  assertPathUnderRoot(resolved, root, relPath);

  const rootReal = realpathIfExists(root);
  if (!rootReal) return resolved;

  const existingAncestor = nearestExistingAncestor(resolved);
  const existingAncestorReal = realpathSync(existingAncestor);
  assertPathUnderRoot(existingAncestorReal, rootReal, relPath);

  const dereferenced = path.resolve(
    existingAncestorReal,
    path.relative(existingAncestor, resolved),
  );
  assertPathUnderRoot(dereferenced, rootReal, relPath);

  return resolved;
}

function assertPathUnderRoot(candidate, root, relPath) {
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (candidate !== root && !candidate.startsWith(prefix)) {
    throw new Error(`refused unsafe data path: ${relPath}`);
  }
}

function realpathIfExists(file) {
  try {
    return realpathSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function nearestExistingAncestor(file) {
  let current = file;

  while (true) {
    try {
      statSync(current);
      return current;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}
