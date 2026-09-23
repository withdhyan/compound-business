# Compound Business runtime

The engine the roles stand on: business state, gates, and the rules that make
the memory compound instead of drift. It is plain Node ESM with no dependencies
and no network access. Nothing here sends, posts, pays, or signs — effectuators
live outside, and every one of them passes this module's gates first.

## What it is (Phase A)

| Module | Job |
|---|---|
| `records.mjs` | Closed record world — `BusinessUnit`, `BusinessDecision`, `BusinessMetric`, `BusinessRule`, `BusinessStage`, `AuthorityGrant`, `AuditEntry` — with builders and full shape validation |
| `store.mjs` | Hash-named, bitemporal JSON records under `<dataDir>/company/<kind>/`; supersede, never mutate; one live record per (kind, dedupeKey); unit identity pinned across supersession; approvals verified against stored grants |
| `unit.mjs` | A business move is a unit: `planned → approved → running → review → shipped`, or `held` / `killed`. Review comes from a different role; irreversible units need a founder receipt |
| `stage.mjs` | The 0→100 stage machine: each stage names its binding constraint and exit criteria; moves are +1 only; evidenced, not vibed |
| `ladder.mjs` | Authority fails closed: advise → draft → reversible (live founder grant, budget hard stop) → irreversible (plus founder receipt). `authorizeAndSpend` persists the spend before anything executes |
| `kernel.mjs` / `safe-path.mjs` | The envelope and path guards; no host dependencies |

The binding law is in [`AGENTS.md`](./AGENTS.md) beside the modules.

## Use

```js
import { createCompanyStore } from './runtime/store.mjs';
import { buildBusinessUnit } from './runtime/records.mjs';
import { transitionUnit } from './runtime/unit.mjs';

const store = createCompanyStore({ dataDir: '/path/to/business/data' });
await store.writeRecord(buildBusinessUnit({ ...fields }, () => new Date()));
```

Tests:

```bash
node --test runtime/*.test.mjs
```

## Status, honestly

- Phase A only: state and gates. The roles (`/chief`, `/money`, `/gtm`, …) are
  not wired to it yet, and there is no daemon, scheduler, or tool connector.
- Review and founder receipt *presence* is pinned on records; resolving those
  ids to a card or artifact is the wiring layer's job.
- Costed actions must go through `authorizeAndSpend` — the pure
  `authorizeAction` check does not spend.
- Reviewed by an independent lane over four adversarial rounds; 57 tests.
