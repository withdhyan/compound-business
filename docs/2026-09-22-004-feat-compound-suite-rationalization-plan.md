---
title: "Plan — compound suite rationalization + CB v0.2 gap plug"
date: 2026-09-22
area: skill-suite
type: plan
status: superseded-by-rethink
source: docs/audits/2026-09-22-compound-suite-audit.md
superseded_by: docs/brainstorms/2026-09-22-agent-run-business-0-to-100.md
---

# Plan — rationalize the compound suite, plug the business gaps

> **Founder ruling 2026-09-23:** the runtime is separate from K. Engine lives in
> this repo (`runtime/`); Holon runs it locally. K keeps only the skills audit
> (`cs-k/docs/audits/2026-09-22-compound-suite-audit.md`).
>
> **Superseded 2026-09-22** by the complete rethink
> (`docs/2026-09-22-company-as-factory-deep-design.md`). Kept for the phase
> detail, which folds into that document's build order (Phase A/B).

## Outcome (finish condition)

One coherent business-capable suite: the four compound families read and write through
one stated memory contract, overlaps have single owners, and the missing roles exist and
are dogfooded on the real business (`~/ai/holon-hq`) — with cb's new roles built by its
own skill-TDD (`new-role`) and publishable as v0.2 only after evals and founder review.

## Decisions needed from the founder (blocking)

1. **Target and order.** Build CB v0.2 locally + dogfood on holon-hq, publish after
   evals (recommended); or K-local only, no publish; or plan only for now.
2. **Marketing ownership.** `compound-marketing` becomes the method that cb `brand` /
   `content` / `growth` defer to for K/Holon (recommended); or cb keeps its own
   marketing method and `compound-marketing` is retired for K.

Everything below assumes the recommended answers; it is written so the other answers
only cut scope.

## Phase 0 — mechanical rationalization (no new authoring)

- [ ] Refresh compound-engineering: marketplace refresh first, then update plugin
      (3.26.3 → 3.28.0; adds `wtf`, `ce-work` reasoning-effort config).
- [ ] cs-k: collapse `.agents/skills` / `.claude/skills` duplication to one source with
      the other as a symlink (or a checked sync script). Bring the four drifted files
      back together (`design-thinking`, `k-copy`, `research`, `status-build`); add
      `compound-marketing` to `.agents`; resolve `pocock` (currently `.agents` only).
- [ ] cb: pull `~/ai/cb` and the marketplace clone to origin/main (doc-only delta).
- [ ] cb v0.2 seam fixes from its own dogfood log:
      install-time local-duplicate check; standing-rules bullet check (not just file
      present); shared-schema single owner in dispatch; holding-company rule-promotion
      note; parallel one-file-per-role contract written down.

## Phase 1 — one memory contract

- [ ] Write `MEMORY.md` in cb (generic) — read-first surfaces, write-back rules,
      evidence classes (measured/estimated/assumed), outbox gate, lever typing,
      supersession-not-delete, silence over fabrication.
- [ ] Update cb `README.md` + `cb-init` to install the contract; state the
      upstream/instance rule (CB generic; project rules local).
- [ ] Reference the contract from `compound-marketing` and `compound-design` (K side
      additionally keeps `resolveDoctrine`; the contract says when to read it).
- [ ] Add a thin business router: `chief` routes, or a new `cb-router` skill for
      "I don't know which role this is" (mirrors Anthropic `smb-router`).
- [ ] cb learnings gain lightweight receipts: each durable rule cites the event that
      produced it and carries `status: live | pruned` (+ why). Supersede, never delete.

## Phase 2 — P0 roles (the live bottleneck: capital + GTM)

Each role: authored by `new-role` skill-TDD (RED baseline failure from Holon's real
runs → write → re-run scenario → deploy), ≤150 lines, description = when-to-use,
Ground truth → Procedure → write-back. Dogfood on `~/ai/holon-hq`; orchestrator
reconciles and commits once (parallel-run contract).

1. **`capital`** — fundraising pipeline, deck version ledger, data room index,
   investor-update drafts (outbox), term-sheet red lines, run-rate/runway awareness
   (reads `money` outputs once they exist).
2. **`money`** — cash snapshot, AR chase, AP/bills, close prep, tax/entity calendar,
   spend register; **coding bills and paying bills are two separate approvals**; a
   figure that cannot be read is reported unreadable, never guessed.
3. **`gtm`** — lead triage, outreach drafts to outbox, pipeline + next-action state,
   call prep, proposal/quote drafts; pre-registered experiment thresholds like
   `growth`; `partnerships` keeps BD/grants.

Pricing is a mode inside `money` + `gtm` (a pre-registered price test artifact filed in
STRATEGY), not a separate role yet.

## Phase 3 — P1 roles (keep the machine honest)

4. **`ops`** — vendor/subscription register, process runbooks, compliance calendar
   (entity, tax, insurance, renewals), risk register.
5. **`contracts`** — contract triage against a playbook, redline, e-sign path;
   `counsel`'s SHIP/FIX gate contract applies unchanged (extend `counsel` if a new
   role would overlap it).
6. **`support`** — ticket triage, incident runbook, KB articles; `community` keeps
   sensitive-population comms.

## Phase 4 — evidence, then publish

- [ ] Role benchmark: blind-score `capital` / `money` / `gtm` outputs against real
      expert artifacts (cb's own pre-v1 promise).
- [ ] Compounding demo: same task at week 0 vs week N of learnings, diffed.
- [ ] Publish gate: founder review of the diff and README claims; then push CB v0.2.
      Publishing is founder-gated; no autonomous publish.

## Gates

- `npm test` for any cs-k change (skill dedup, marketing edits).
- cb roles: `new-role` skill-TDD evidence per role before deploy; one role at a time.
- Holon dogfood: real runs only, orchestrator commits once, no role edits shared files.
- Money: advisory only until a K-namespaced canary + machine-pull pass for any payment
  rail (mirrors K's Speediance rule); K egress registry governs any MCP call.

## Not in scope (deliberately)

- Porting CB to other harnesses (CE's multi-host manifests are the template; later).
- Making CB stateful/runtime (company-brain upgrade) — that is a separate bet.
- Auto-anything: no auto-promotion, no auto-send, no auto-pay.
