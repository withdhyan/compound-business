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
| `mine.mjs` | Read-only scan of configured history sources for candidate ideas (`inbox` and `marker` modes; `.md`/`.txt`/`.jsonl`, including chat histories — user-authored text only) |
| `policy.mjs` | Labels (`public < team < founders < personal`), per-principal grants, the founder list, external shares, optional stage ladder. Loaded from `<data>/policy.json` |
| `memory.mjs` | Read side of the memory layer: index, per-task `get`, `show`, citation check, eval. Labelled markdown files plus labelled records |
| `curation.mjs` | The curation queue: `propose` (pending, invisible) and `approve` (live) |
| `mcp.mjs` | Optional stdio MCP server over get/show/cite-check, bound to one principal |
| `cli.mjs` | The creator loop's command surface: idea add/list/show/amplify/evaluate/decide/advance, and mine |
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

The creator loop from the shell:

```bash
# record an idea, then let the agent amplify it (see skills/amplify/SKILL.md)
node runtime/cli.mjs idea add "A CLI that mines my notes for ideas"

# stage candidates from your own history (config: runtime/sources.example.json)
node runtime/cli.mjs mine --config sources.json

# what's waiting
node runtime/cli.mjs idea list --status seed
```

Auto-run is a scheduled `mine` — a launchd/cron job on your machine (you
install it; the runtime never schedules itself). Evaluation and amplification
run when an agent next checks the queue.

## Memory layer: labels, retrieval, curation

Every memory item carries one label: `public`, `team`, `founders` or
`personal`. Markdown files use frontmatter (`label: team`); records carry a
`label` field (set with `--label` on `idea add` / `mine`, or `label:` in a
builder input). **An item with no valid label is unreadable to everyone.** A
label cannot be changed or dropped by a successor record (supersession cannot
launder access); a legacy unlabelled record may gain one.

`<data>/policy.json` (or `--policy <file>`; a missing default file means one
founder who owns everything, the old behaviour):

```json
{
  "owner": "founder",
  "founders": ["founder", "cofounder"],
  "principals": { "founder": "personal", "cofounder": "personal", "guest-artist": "team", "scribe-bot": "team" },
  "externals": { "artist": ["mem_0123456789abcdef", "memory/brand/kit.md"] },
  "stages": [
    { "name": "measures", "bindingConstraint": "a signed partner", "exitCriteria": ["partner_signed"] },
    { "name": "k_loop", "bindingConstraint": "a measured loop", "exitCriteria": ["loop_metric"] }
  ]
}
```

- `principals`: a human or agent, mapped to the highest label it may read.
- `personal` is owner-only: readable only by the item's owner (frontmatter
  `owner:`, default the policy owner) and only if that principal's grant is
  `personal`.
- `founders`: principals who may grant authority, decide levers, issue the
  backward stage lever, and approve pending entries. Replaces the old
  single-`founder` literal; `["founder"]` is the default.
- `externals`: outside people. No tier: they read `public` items plus
  `team` items shared to them by id or path. Sharing never lifts a `founders`
  or `personal` item.
- `stages`: optional ladder. Absent = the revenue ladder
  (`idea` ... `scale`). Present = these stages, in order, +1 moves only.

Markdown frontmatter keys: `label` (required to be readable), `title`,
`summary`, `updated`, `superseded-by` (an id or a path), `owner`, `id`
(`mem_` + 16 hex; otherwise derived from the path). Memory files are read from
`<data>/memory` or each `--memory <dir>`. Dot files and symlinks are skipped.

Every read names its principal with `--as`; there is no default.

**Trust model.** Labels are a retrieval filter, not an operating-system
boundary. They hold when (1) agents get the MCP server (`cb mcp --as <p>`) with
the principal fixed in the harness config, and (2) agents run as an OS user
without file access to the memory and data directories. `--as` and `--policy`
on the CLI are trusted-operator flags; an agent with a shell can claim any
principal or read the files directly. Other rules that fail closed: a repeated
`label`/`id`/`owner`/`superseded-by` frontmatter key withholds the file; a
`personal` item needs an explicit owner (`propose` stamps the proposer; with
several founders the policy needs an explicit `owner` for ownerless personal
items to be readable); memory directories must have distinct names.

**Migration.** If `founders` in `policy.json` does not include the literal
`founder`, grants issued by `founder` stop being live and old `founder`-decided
levers fail the shape check on re-write.

```bash
cb index --as guest-artist                 # path, label, title, summary, updated, superseded-by
cb get --as guest-artist "residency terms" # matching items inside guest-artist's grant, with ids to cite
cb show --as guest-artist mem_0123456789abcdef
cb cite-check --as guest-artist reply.md   # exit 1 on a missing or superseded citation (`-` = stdin)
cb propose --as scribe-bot --label team --title "..." --quote "founder's words" --source "thread 2026-11-09"
cb pending --as cofounder               # founders only: label, source, quote
cb approve --as cofounder mem_...       # makes pending entries live
cb eval --as guest-artist --file tasks.json [--min 0.8]   # [{"query": "...", "expect": ["id", ...]}]
cb mcp --as guest-artist                   # stdio MCP: cb_get, cb_show, cb_cite_check (read-only)
```

(`cb` is `node runtime/cli.mjs [--data <dir>]`.) Add `--json` for machine output.

- An item outside the grant looks exactly like a missing one: `show` says
  `no item: <id>`, `cite-check` says `missing`, and a replacement pointer is
  shown only if the replacement is also readable.
- `get` returns superseded items last, with `replacement` set.
- `index` and `get` recompute from disk on every call, so an edited item reaches
  the next task with no rebuild; nothing is persisted.
- Citations are recognised by id shape (`mem_...`, `bdec_...`, `brule_...`, ...).
- Pending entries live in `<data>/pending/`, which no read path scans.
  `approve` writes `<memory>/approved/<id>.md` with source, proposer, approver
  and date in the frontmatter; the id shown at `propose` is the citation id.
- `eval` reports recall: expected ids found in the top results of `get`.
  A task whose expected id is outside the principal's grant counts as missed.

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
- Phase A was reviewed by an independent lane over four adversarial rounds. The memory layer (labels, retrieval, curation, MCP, configurable stages) has not had that review yet.
- Retrieval is keyword match over title, summary and body. No embeddings; `cb eval` is how you find out when that stops being enough.
