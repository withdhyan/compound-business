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
- Nothing here sends, posts, pays, or signs. Effectuators live outside; this
  module records state and gates.
