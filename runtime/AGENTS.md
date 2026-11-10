# Company runtime law

This is the runtime's law. It is the business state surface — units,
decisions, metrics, rules, stage, authority. Nothing here reaches the network.

- The unit state machine in `records.mjs` is law: transitions only through
  `transitionUnit`; a new state or edge is an ADR-level change. A unit starts
  `planned`; a reversible or irreversible unit carries an `actionScope` and
  needs a live founder grant to be approved.
- Business state is written only through `CompanyStore`; the caller passes an
  explicit data directory (tests use a temp dir). Record ids are
  kind-prefixed hashes and the store refuses anything else — no
  model-supplied path can become a filename.
- The store re-checks every record's shape (`assertCompanyRecordShape`) and pins
  a unit's identity across supersession: title, stage, goal, evidence,
  verification, kill criterion, owner role, review role, authority class, and
  action scope cannot change. A successor cannot relabel a unit to dodge the
  review or grant gates.
- The store verifies approval evidence: a reversible or irreversible unit can
  only become `approved` with a `grantId` that resolves to a live grant whose
  class, scope, and role match, plus the `approvedBy` actor. A shipped
  irreversible unit carries a founder receipt.
- Supersede, never mutate: a correction closes `validTo` and sets
  `supersededById`; the predecessor stays readable. At most one live record per
  (kind, dedupeKey); a successor must be live and must name a live predecessor.
  Mutations serialize per resolved dataDir (two stores on one directory cannot
  race); cross-process serialization is the daemon's lock. A torn supersession
  degrades to silence, never to two live records.
- Authority fails closed (`ladder.mjs`): advise and draft need no grant;
  reversible needs a live, founder-issued, unexpired, unrevoked grant for the
  actor, class, and a scope the caller must name; irreversible additionally
  needs a founder receipt; any non-`false` brake signal stops every
  non-advisory action. Unknown classes are refused, never coerced.
- `authorizeAction` is the pure check. Wiring uses `authorizeStoredAction`
  (grants resolved from the store by id; a missing id throws) and
  `authorizeAndSpend`, which persists the successor grant before the action
  executes. A grant never authorizes before its `validFrom`.
- Review never comes from the executor's role, and a shipped unit carries its
  reviewer, receipt, and approval grant ids on the record.
- Metrics carry a definition, an as-of date, and an evidence class; a null
  value means unreadable, never guessed. Rules carry a receipt id; pruned rules
  say why. Stage moves are +1 only, need criterion evidence that is not all
  assumed, and a backward move needs a founder lever (`stage.mjs`).
- Memory is label-gated (`policy.mjs`, `memory.mjs`): an item with no valid
  label is unreadable to everyone; every read names its principal; an item
  outside the grant is indistinguishable from a missing one; `personal` is
  owner-only; externals read `public` plus explicitly shared `team` items. A
  label never changes or drops across supersession. Pending proposals are
  stored where no read path scans, and only a founder who can read the label
  approves them.
- Edits supersede (`propose --supersedes`): the target must be a live file
  the proposer can read, at the same label; one pending edit per target;
  only an approved file under `approved/` can supersede, and the old file is
  never rewritten. Evidence ids must resolve in the proposer's own grant.
- Untrusted-source content is promoted only by a founder principal passing
  `founderApproved`; an agent cannot assert it for itself.
- `reportable` (measures) and `counted` (receipts) are derived and re-checked
  on every write; a record cannot claim them. Money is counted only with
  recipient acceptance, payment date and signed scope.
- Ledger reads name a principal and are label-filtered; ledger writes are
  founder-only and cite evidence that resolves. A reportable or data-bearing
  measure cannot change its design. `cb_propose` (MCP) is bound to the launch
  principal and carries no trust or approval inputs.
- `supersedes:` is honoured from any file under an `approved/` memory
  directory; whoever can write files there can retire an item. File access is
  outside the trust model.
- Finding things: with 200 visible items or fewer, start with `cb_index`
  (id, label, title, summary, updated, superseded; no bodies; the principal is
  the launch principal and arguments cannot change it), pick ids, then
  `cb_show` them. Larger stores: `cb_get` with 2-3 phrasings ("q1 | q2"), then
  `cb_show`.
- Trust model: labels are a retrieval filter, not an OS boundary. They hold
  only when agents reach memory through the MCP server (`cb mcp --as <p>`),
  with the principal fixed in the harness config, and run as an OS user with
  no file access to the memory or data directories. `--as` and `--policy` on
  the CLI are trusted-operator flags: anyone who can run the CLI or read the
  files can claim any principal. Ambiguous attributes fail closed: a repeated
  `label`, `id`, `owner` or `superseded-by` key withholds the file; a
  `personal` item with no resolvable owner is unreadable; duplicate ids are
  withheld only among items the reader can already see; `authorizeStoredAction`
  takes the founder list from the store, never from the caller.
- Founder authority is a list of principals in the policy (default
  `["founder"]`), not a literal. Stage names and exit criteria come from the
  policy when configured; the +1-only rule and the founder lever for backward
  moves do not.
- Nothing here sends, posts, pays, or signs. Effectuators live outside; this
  module records state and gates.
