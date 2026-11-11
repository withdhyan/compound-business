// Child process for lock.test.mjs: plays one writer (an MCP server or a CLI run)
// against a shared data directory.
import path from 'node:path';

import { propose } from './curation.mjs';
import { buildPolicy } from './policy.mjs';
import { createCompanyStore } from './store.mjs';
import { suggestTriage } from './trace.mjs';
import { triage } from './triage.mjs';

const RULES = 'mem_aaaaaaaaaaaaaaaa';
const policy = buildPolicy({
  owner: 'founder',
  founders: ['founder', 'cofounder'],
  principals: { founder: 'personal', cofounder: 'personal', scribe: 'team', teammate: 'team' },
});
const [role, dataDir, ids] = process.argv.slice(2);
const ctx = { store: createCompanyStore({ dataDir, policy }), policy, dataDir, memoryDirs: [path.join(dataDir, 'memory')] };
let ok = 0;
for (const id of ids.split(',')) {
  try {
    if (role === 'agent') {
      await suggestTriage(ctx, 'scribe', id, 'test', 'x');
      await suggestTriage(ctx, 'teammate', id, 'system', 'y');
    } else if (role === 'exception') {
      await triage(ctx, 'founder', id, 'exception', { note: 'one-off' });
    } else if (role === 'test') {
      await triage(ctx, 'cofounder', id, 'test', { query: `q ${id}`, expect: [RULES] });
    } else if (role === 'propose') {
      await propose(ctx, 'scribe', { label: 'team', title: `P ${id}`, quote: `q ${id}`, source: 's' });
    }
    ok += 1;
  } catch {
    // a losing writer is refused; the test inspects the resulting state
  }
}
console.log(JSON.stringify({ role, ok }));
