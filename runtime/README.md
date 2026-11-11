# Compound Business runtime

The engine the roles stand on: business state, gates, and the rules that make
the memory compound instead of drift. It is plain Node ESM with no dependencies
and no network access. Nothing here sends, posts, pays, or signs — effectuators
live outside, and every one of them passes this module's gates first.

## What it is (Phase A)

| Module | Job |
|---|---|
| `records.mjs` | Closed record world — `BusinessUnit`, `BusinessDecision`, `BusinessMetric`, `BusinessRule`, `BusinessStage`, `BusinessTrace`, `AuthorityGrant`, `AuditEntry` — with builders and full shape validation |
| `store.mjs` | Hash-named, bitemporal JSON records under `<dataDir>/company/<kind>/`; supersede, never mutate; one live record per (kind, dedupeKey); unit identity pinned across supersession; approvals verified against stored grants |
| `unit.mjs` | A business move is a unit: `planned → approved → running → review → shipped`, or `held` / `killed`. Review comes from a different role; irreversible units need a founder receipt |
| `stage.mjs` | The 0→100 stage machine: each stage names its binding constraint and exit criteria; moves are +1 only; evidenced, not vibed |
| `ladder.mjs` | Authority fails closed: advise → draft → reversible (live founder grant, budget hard stop) → irreversible (plus founder receipt). `authorizeAndSpend` persists the spend before anything executes |
| `mine.mjs` | Read-only scan of configured history sources for candidate ideas (`inbox` and `marker` modes; `.md`/`.txt`/`.jsonl`, including chat histories — user-authored text only) |
| `policy.mjs` | Labels (`public < team < founders < personal`), per-principal grants, the founder list, external shares, optional stage ladder. Loaded from `<data>/policy.json` |
| `memory.mjs` | Read side of the memory layer: index, per-task `get`, `show`, citation check, eval. Labelled markdown files plus labelled records |
| `curation.mjs` | The curation queue: `propose` (pending, invisible) and `approve` (live) |
| `trace.mjs` | Decision traces: a `BusinessTrace` record per proposal, appended by propose, edit, approve, reject, outcome and triage; label = max of what it references |
| `triage.mjs` | Three-way triage of corrections (exception, test, system) and the frozen holdout eval file |
| `mcp.mjs` | Optional stdio MCP server over get/show/cite-check, bound to one principal |
| `evals.mjs` | Eval history (`data/evals/history.jsonl`) and the week-0 vs now trend |
| `ledger.mjs` | Add/update/list for `BusinessMeasure` and `BusinessReceipt`; counted-money total |
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
cb propose --as scribe-bot --label team --title "Growth rules, wk 46" --supersedes mem_... \
   --body "<revised text>" --quote "..." --source "retro 2026-11-13" --evidence "eval recall 0.4 -> 0.6" --evidence mem_...
cb pending --as cofounder               # founders only: label, source, quote
cb digest --as cofounder [--out f]      # pending approvals in full: label, source, quote, full change, summary, owner, evidence; WRITE-DOWN flagged. --out writes mode 600 and prints only a count
cb reject --as cofounder <id>... | --stale   # drop pending entries (stale = older than 30 days; they also stop blocking edits)
cb approve --as cofounder mem_...       # makes pending entries live
cb eval --as guest-artist --file tasks.json [--min 0.8]   # [{"query": "...", "expect": ["id", ...]}]
cb eval --as scribe-bot --file evals/growth.json --role growth --record   # also append to data/evals/history.jsonl
cb eval-trend --as cofounder [--role growth]    # founders only: week-0 vs latest recall per role
cb record add measure|receipt --as cofounder --file x.json --label founders   # founder only
cb record update <id> --as cofounder --file patch.json   # founder only; supersedes; keeps label; re-derives reportable/counted
cb record list measure|receipt --as <p>        # only records inside p's grant; receipts print counted vs not, per currency
cb mcp --as guest-artist [--untrusted]    # stdio MCP (--untrusted stamps proposals untrusted): cb_index, cb_get, cb_show, cb_cite_check, cb_propose (pending only), cb_trace_list, cb_trace_show, cb_trace_suggest
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

### Compounding: edits, evidence, trend

- **Edits supersede, never overwrite.** `propose --supersedes <id>` names a live memory file the proposer can read, at the same label (a label never changes). It stays pending until a founder approves. `approve` writes the successor under `approved/` with a `supersedes:` line; readers then see the old item as superseded, with the replacement. The old file is not touched and stays readable. Only `approved/` files can supersede; two claimants for one item apply neither (founders see a warning in `index`).
- **One pending edit per item.** A second proposal against the same target is refused (the error does not name the rival), so a retro folds its changes into one `--body`. A founder's edit displaces a non-founder's pending one. `propose` and `approve` are serialized per data directory.
- **The digest shows what will be written**, in full, and flags a `WRITE-DOWN` (proposer's grant above the item's label). Evidence ids above the item's label are redacted when approved. Approved untrusted items show `trust: untrusted` in `get`/`show`.
- **Evidence.** `--evidence` (repeatable, at most 10) is free text or item ids. Cited ids must resolve in the proposer's own grant. It is kept on the pending entry, in `digest`, and under `Evidence:` in the approved file.
- **Untrusted sources.** `--trust untrusted` is refused unless the proposer is a founder and passes `--founder-approved`. See `docs/injection.md`.
- **Retrieval.** `get` ranks with BM25 over stemmed tokens (title, alias and summary hits weigh more than body hits), plus a small built-in synonym map of generic business and research words (funder/investor/backer/patron, money/funding/capital, deck/presentation/pitch, false/untrue, and so on). Corpus statistics use only the items the reader can see. An item may carry `aliases: a, b` in its frontmatter (indexed like the title; `propose --aliases "a, b"` adds them, and the digest shows them). `get "q1 | q2 | q3"` ranks the union of several phrasings by reciprocal rank.
- **Scorecards.** `eval --record` appends one aggregate line (time, principal, role, recall, hits, expected, task count; no query text) to `<data>/evals/history.jsonl`. `eval-trend` compares each role's first and latest run.
- **Ledger records.** `BusinessMeasure` (instrument, partner, signed, prereg, threshold, population; `reportable` is derived: signed and preregistered) and `BusinessReceipt` (counterparty, what, amount, currency, recipientAcceptance, paymentDate, signedScope; `counted` is derived: acceptance and signed scope are memory item ids, the payment date is an ISO date not in the future). Totals are per currency. A reportable (or data-bearing) measure cannot change instrument, partner, prereg, threshold or population: a new design is a new measure. Both are labelled, retrievable with `cb get`, and corrected by supersession. Ids: `bmeas_...`, `brcpt_...`.

### Decision traces and triage

A correction is not a rule. Curation keeps the context instead (the pattern:
decision traces preserve curated context so learnings are reused without
treating every correction as a rule).

- **Trace.** `propose` opens a `BusinessTrace` (`btrace_...`): subject, context item ids (the item an edit replaces plus every cited evidence id), proposal id, `edits[]`, the final decision (`approved` with the live item id, or `rejected`), `outcome`, `triage`, `suggestions`, label, created and updated. `editPending`, `approve` and `reject` append to it; each step is a successor record, so the whole history stays on disk. Identity, edits, suggestions, a decision and a triage cannot be rewritten (the store refuses). A proposal re-proposed after a rejection gets its own trace.
- **Label.** The max of the proposal's label and the labels of everything it references. A team principal cannot read a trace that cites a founders item, and an unreadable trace looks exactly like a missing one. A pending trace is visible only to founders and its proposer (it must not leak an invisible proposal's title). Traces are not memory items: `get` and `index` do not return them.
- **Correction** = a proposal a founder rejected or edited before approving.

```bash
cb edit --as cofounder <pending id> [--title t] [--summary s] [--body b] [--aliases "a, b"]   # founder; the change is kept on the trace
cb reject --as cofounder <id>... [--note "why"]
cb trace list|show|suggest|outcome ...                  # list [--untriaged], show <id>, suggest <id> exception|test|system [--note n]
cb trace outcome <id> <text> --as cofounder             # founder only: what happened later (supersedes the trace)
cb triage <trace> exception|test|system --as cofounder --note "the founder's words" [flags]
cb holdout list|run --as cofounder                      # founders only
```

`cb triage` is founder-only and sets the class once:

| class | effect |
|---|---|
| `exception` | The note is stored on the trace as context. Never a rule. |
| `test` | Appends one frozen case to `<data>/evals/holdout.jsonl`: `--query q --expect <id>...` (a query and the item it should find) or `--draft text --verdict SHIP\|FIX\|READY\|"NOT READY"` (a draft and the verdict it should get). |
| `system` | Queues a pending proposal (`--body`, optional `--target <item id>` to supersede a rulebook, skill or policy item, `--title`). `--note` is its quote. A founder still approves it. |

`cb digest` ends with the untriaged corrections, each with the three choices and any class an agent suggested. Agents (MCP) get `cb_trace_list`, `cb_trace_show` (read-only) and `cb_trace_suggest` (a note on the trace; it sets nothing). They cannot triage, record outcomes or reach the holdout.

**Eval hygiene.** Cases made by triage go to the frozen holdout, a different file from the eval history and from any `--file` task list. The retro never trains, tunes or proposes against it: it is not exposed through MCP, `cb holdout` and `cb eval-trend` are founder-only, `cb eval --file` refuses the holdout path, `cb holdout run` is never written to `history.jsonl`, and the file is append-only (a case is never edited or removed by the runtime). Why: overfitting. Rulebooks and aliases tuned until their own test set passes measure the tuning, not the memory; the alias experiment lifted recall on the queries the aliases were written for and not on queries written afterwards. A holdout stays honest only if nobody who edits the system can see it.

Tests:

```bash
node --test runtime/*.test.mjs
```

## Status, honestly

- Phase A only: state and gates. The role skills read and write through the memory layer (`cb get`/`cb propose`); they are not yet wired to units, grants or stages. There is no daemon, scheduler, or tool connector (see `docs/steward.md` for the scheduler recipe).
- Review and founder receipt *presence* is pinned on records; resolving those
  ids to a card or artifact is the wiring layer's job.
- Costed actions must go through `authorizeAndSpend` — the pure
  `authorizeAction` check does not spend.
- Phase A was reviewed by an independent lane over four adversarial rounds. The memory layer (labels, retrieval, curation, MCP, configurable stages) has not had that review yet.
- Retrieval is keyword match over title, summary and body. No embeddings; `cb eval` is how you find out when that stops being enough.
