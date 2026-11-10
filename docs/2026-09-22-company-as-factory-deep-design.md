---
title: "The company as a factory — deep design for an agent-run business, 0→100"
date: 2026-09-22
area: company-runtime
type: brainstorm
status: conclusion-ready
method: CE/factory doctrine read + K factory law (src/agent/AGENTS.md, stations/) + world scan (habitats, control planes, identity/governance, operating models, outcome data) + Holon live state
supersedes: docs/brainstorms/2026-09-22-agent-run-business-0-to-100.md
---

> **Founder ruling 2026-09-23 — separate from K.** The company runtime is not a K
> feature. Git home: this repo (`runtime/`). Local instance: `~/ai/holon-hq`
> (business state under `data/company/`). K keeps only the skills audit. The
> "runtime home" recommendation below is settled this way; everything else stands.

# The company as a factory

## Conclusion first

Thin fails. Compound engineering's own lesson — and K's build factory already proves it —
is that the depth lives in the **machinery around the work**: a state machine that is law,
gates that fail closed, review by a different lane, cards as the only founder surface,
memory that compounds, and evals with a fixed ruler. A business run by an agent needs the
same class of machinery applied to business units of work — not a rolodex of role prompts,
and not a chat.

The world converged on this in 2026. Three markets formed: **habitats** where humans and
agents share channels (Buzz, Cloudflare OS, Tasklet, Centaur), **control planes** that
orchestrate agents as employees (Paperclip — 80k stars, org charts, budgets, heartbeats,
approvals; Thoughtworks Agent/works; Zero Human Labs), and **operators** that run a
specific business function end-to-end (COVU OS for insurance: 150k tasks in 30 days, 2–3x
EBITDA; Rex for order-to-cash: $500M receivables; DZHC: agent DIDs + multisig treasury +
emergency brake). The outcome data is real: Klarna reports ~700 FTE-equivalents of support
work, Devin handles 20–45% of issue backlogs, revenue-per-employee +30–80% at ZHC-level
operators.

K's factory is already deeper than Paperclip in the ways that matter for sovereignty —
fail-closed gates, review-by-another-lane, card-gated irreversible action, labeled egress,
doctrine with receipts — and shallower in ways the market already solved: agent identity,
heartbeats, budgets, tool access, habitat. The move: **business work runs as units through
K's factory; the missing layers are adopted or plugged, not reinvented thin.**

## 1. What CE and the factory teach (why thin is not an option)

From compound engineering and K's own factory law, the load-bearing properties:

1. **Plan is 80% of the work.** CE's loop spends most effort in brainstorm and plan; the
   work step is small by comparison. A business move without a plan artifact (goal,
   evidence, verification, kill criterion) is the business equivalent of writing code
   before a spec.
2. **The state machine is law.** `build-state.mjs` transitions only through
   `transitionUnitToward`; new states are ADR-level changes. Business work needs the same:
   a move has states, transitions are code, not vibes.
3. **Gates fail closed.** Test gate, ce-gate, and review gate refuse; a refusing path is
   never converted to record-only. Irreversible business actions (send, post, pay, sign,
   file) must be the same: no path to `[auto]`.
4. **Review comes from a different lane.** An executor's self-report is never verification.
   Business roles must never review their own work — a different role or model reviews
   before a gate closes.
5. **Cards are the founder interface.** Every hold carries a card with evidence, contrast,
   and stakes; a card the founder can't act on plainly is a bug. That is the human-above-
   the-loop surface; it already exists.
6. **Memory compounds or it's decoration.** `docs/solutions/` entries are read by the next
   plan; doctrine has receipts and supersession. Business rules need the same write/read
   discipline per role, with retrieval guaranteed before the next run.
7. **Skills are deep files, not summaries.** CE skills have references, scripts, and
   per-skill pages; each is a procedure with an output contract. One-page role blurbs are
   the thin failure mode.
8. **Isolation and a single writer.** Lanes run in worktrees; the runner is the single
   writer of plan state. CB's dogfood found the business version of this seam on day one
   (two roles defining overlapping schemas). Parallel business work needs the same
   isolation and one reconciler.
9. **Egress is labeled.** Every off-machine call matches a registry line. Business
   outreach, publishing, and payments inherit this; nothing "just sends".
10. **Silence is a valid outcome.** Stale or low-confidence signal yields silence, not
    fabrication. Business roles must be allowed to report "no action warranted".

The deep design below is these ten properties, applied to a company.

## 2. World scan (as of 2026-09-22)

### 2.1 Habitats — where humans and agents work together

- **Buzz** (Block / Jack Dorsey, announced 2026-07-21, v0.4.21): Apache-2.0, Nostr-based
  workspace merging chat, threads, DMs, git hosting, and workflows. Agents get
  **cryptographic identities, scoped permissions, their own memory, and audit trails**,
  and can create channels and coordinate. Block says "every company is going to need a
  place where humans and agents work together" — the question is whether it's open.
  Positioned against Slack + GitHub; desktop only, mobile pending, security skeptics on
  shared-channel data leakage. Centaur (Paradigm's Georgios Konstantopoulos) is the
  Slack-native "virtual employee" variant.
- **Cloudflare OS** (announced 2026-08-04/05): open-source AI workspace, runs in the
  company's own Cloudflare account. Agents start with **zero permissions** and receive
  only what a task needs; **Gatekeepers** govern connectors with owner-set sign-off;
  model-agnostic with cost routing. Cloudflare runs its own company on it.
- **Tasklet** (YC, $20M, ~$5M ARR, GA 2026-04): cloud "agent OS for work"; connects to any
  HTTP API, MCP server, or a full browser; takes real actions; scheduled and event-driven
  24/7; audit logging; mobile approvals.
- **Slack as agent OS** and **Centaur** confirm the direction: agents as first-class
  participants in the existing human channel, not a separate tool.

### 2.2 Control planes — the company as an org chart of agents

- **Paperclip** (MIT, first commit 2026-03-02, ~81k stars by September): open-source
  orchestration for zero-human companies. Org chart with roles, reporting lines,
  permissions; **heartbeats** (agents wake on schedule, consume no context between);
  goals → projects → tasks with traceability; **budgets with hard stops** per agent;
  board approvals; audit; secrets scoped per run; workspaces; routines; skills manager;
  MCP tool gateway; **evals & feedback**; company portability (export/import an entire
  org). "If it can receive a heartbeat, it's hired." It is explicit that it is not a chat
  and not a code review system.
- **Thoughtworks Agent/works** (2026-06): capability-based, scope-bound, **time-limited**
  permissions that narrow as an agent touches sensitive systems; **provable compliance
  before execution** (a fully compliant path must exist end to end); a registry with
  evals, usage analytics, and cost controls for the whole fleet.
- **Zero Human Labs**: smart model routing, **circuit breakers, sealed-bid task auctions,
  reputation scoring, hard budget limits**, OpenAI-compatible API.
- **DZHC (Dutch Zero-Human Company)**: agents hold W3C DIDs and Verifiable Credentials;
  treasury is a Safe multisig on Base with board oversight at thresholds; published
  governance with human-in-the-loop checkpoints, human-on-the-loop monitoring, and an
  **emergency brake**; sells the infrastructure (identity, treasury, governance, escrow).
- **ZeroHuman Co.**: autonomous family office; **every action cryptographically attested**
  (signed, timestamped, permanently auditable); ambient/voice-native; trust extended in
  phases ("each phase earns trust before extending it").

### 2.3 Operators — one function run end-to-end

- **COVU OS** (insurance distribution, launched 2026-04-10): every request becomes a
  **task**; tasks route to AI, automation, offshore, or a licensed agent by **cost,
  compliance, and complexity**; 230+ task types; 150k+ tasks in first 30 days; 4.77/5 CSAT;
  2–3x EBITDA improvement. Licensed capacity reserved only for steps that require a license.
- **Rex** (YC S26, order-to-cash): connects to ERP, CRM, billing, and the shared AR inbox;
  learns how the team runs the process; that knowledge becomes **editable agent operating
  procedures** (how to chase an F100 buyer vs a startup, when a dispute escalates);
  agents run them in parallel; live managing >$500M in receivables.
- **Klarna**: AI handling the equivalent of ~700 full-time support agents (March 2026
  report); **Devin** reported at 20–45% of GitHub issue backlog handled autonomously at
  customer sites; **Shopify** policy Q1 2026: teams must show AI cannot do a task before
  adding headcount; ZHC-level operators report revenue-per-employee +30–80% over two years
  with quality at parity or better.
- **Lyzr**: its agent (SivaClaw) ran point on its $100M Series B — fielded questions from
  130+ investors, drafted memos, tracked slide engagement.
- **Zero Employee Co**, **Zero Human Ventures**, **Yuki Capital** (AI CEO publishes a
  monthly board review; trust ladder toward more autonomy; productizing as win.sh).

### 2.4 Memory and procedures

- **GBrain** (Garry Tan): 10k+ markdown entity pages (people, companies, meetings, books,
  ideas), read → respond → write loop, hybrid vector+keyword retrieval, three layers
  (world knowledge / operational state / conversation). "Compounding workflows, not
  prompts"; ~100k-page personal knowledge base.
- **Rex's editable agent operating procedures** — learned from human runs, then executed
  at scale: the clearest fielded example of procedure-as-memory in operations.
- **Company-brain wave** (Cognee, Memory Store YC S26, Writer Enterprise Brain,
  Perplexity Brain): shared memory as the only channel between agents; the standing
  warning that plain markdown files break at scale (permissions, concurrent writes,
  temporal queries).

### 2.5 Doctrine and playbooks

- **YC**: Diana Hu's "AI-native company" — AI as the operating system, the company
  **queryable**, closed loops, three archetypes (IC/builder, DRI, AI founder),
  tokenmaxxing over headcountmaxxing, startups' edge over incumbents. Garry Tan's personal
  AGI: own infrastructure, own memory, procedures you wrote, "entire startups these days
  will be markdown files". Anthropic's Founder's Playbook (Idea / MVP / Launch / Scale):
  the danger named outright is **mistaking building for validating** — AI makes it easy to
  forge a convincing case for a bad idea.
- **YC Fall 2026 RFS** includes AI-native compliance infrastructure and "operating systems"
  for real-world domains — the category is being funded as infrastructure.

## 3. What this means for the design (requirements, with acceptance criteria)

1. **State**: one queryable business state — entities, events, decisions, metrics with
   definitions, rules with receipts, stage. *Accept: a role can answer "what is true
   now, and why" without reading chat history; markdown is a projection.*
2. **Units, not chats**: every business move is a unit with a plan (goal, evidence,
   verification, kill criterion), states, and a receipt. *Accept: no external action
   without a unit record.*
3. **Lanes and review separation**: executor ≠ reviewer; a different role or model reviews
   before any gate closes. *Accept: no self-approved output.*
4. **Gates that fail closed**: send/post/pay/sign/file are gated; refusal is a real
   outcome, never converted to record-only. *Accept: no path to unattended irreversible
   action.*
5. **Founder surface**: cards with evidence, contrast, stakes; one inbox; phone-answerable.
   *Accept: the founder's day is answering cards, not supervising agents.*
6. **Agent identity and scoped authority**: agents are principals with scoped, time-limited
   credentials; every mutating action attributed; audit log; emergency brake. *Accept:
   every action names its actor, scope, and receipt; revoke is one operation.*
7. **Budgets and heartbeats**: per-role token/spend budgets with hard stops; scheduled
   wake-ups for recurring work; no run without a budget. *Accept: cost per function is
   visible; overspend pauses, never continues.*
8. **Tools**: read → propose → scoped write; MCP first, browser fallback; egress-labeled.
   *Accept: each function has at least one read connection before any write exists.*
9. **Memory**: per-role learnings with receipts and supersession; retrieval contract
   ("what this role must read before acting") enforced at dispatch. *Accept: a rule that
   is not read by the next run is a bug.*
10. **Evals**: per-stage north-star + leading indicators, pre-registered thresholds, kill
    criteria; held-out checks; ruler outside the loop. *Accept: no stage advances on
    self-reported success.*
11. **Stage machine**: 0→100 with binding constraint, exit criteria, autonomous share, and
    who must decide; roles behave differently per stage. *Accept: a move that belongs to
    another stage is refused, not executed.*
12. **Habitat**: one surface for founder decisions (K's card surface/tailnet), plus an
    optional shared channel where agents and humans work together (Buzz/Cloudflare OS
    class) if it earns its place. *Accept: the founder never needs to read agent chat to
    stay in control.*

## 4. Architecture: business work through the factory

```
                    ┌──────────── founder surface (cards, phone) ────────────┐
                    │  decisions · verdicts · money · identity levers        │
                    └───────────────▲──────────────────────────┬─────────────┘
                                    │ gates                    │ rulings
        stages 0→100 ───────►  STAGE MACHINE (binding constraint per stage)
                                    │
   ┌────────────────────────────────┴───────────────────────────────────┐
   │                         BUSINESS FACTORY                           │
   │  units (moves) │ lanes (roles) │ gates │ review │ receipts │ evals │
   └───────┬────────────────┬───────────────┬────────────────┬──────────┘
           │                │               │                │
     business state     tools (MCP)     identity &        memory (rules+receipts,
     entities/events    money · mail    scoped creds      supersession, procedures
     metrics/decisions  CRM · repos     + audit log       learned from human runs)
```

- **Stations = business functions.** Each is a deep skill package (procedure + references +
  output contract + gates), not a one-pager. Start with the functions that map to the live
  constraint; the rest stay dormant.
- **Units = moves.** A capital raise, a pricing test, an outreach wave, a close-the-month:
  each is a unit with a plan, owner role, review role, gates, and a receipt.
- **Roles = lanes.** Executor and reviewer are different lanes (different role, different
  model where possible). Recurring work runs on heartbeats; exceptions escalate.
- **Routing by cost/compliance/complexity** (COVU's lesson): routine → cheap model or
  mechanical automation; judgment → strong lane; licensed/legal → human. Record the
  routing decision so it compounds.
- **Procedures from real runs** (Rex's lesson): a human run is captured, becomes an
  editable procedure, then executes at scale; procedures are versioned and superseded.
- **Identity, budgets, audit** (Paperclip/Buzz/Agent/works/DZHC's lesson): agents are
  principals with scoped, time-limited credentials; per-role budgets with hard stops;
  every action attested and reversible where possible; emergency brake.
- **Memory and doctrine** (CE/K's lesson): rules carry receipts; corrections supersede;
  doctrine promotion stays founder-gated. K's doctrine store is the model, not a wiki.
- **Stage machine** (YC's lesson): stage 0 gate = office-hours forcing questions + design
  doc; stage 1 = demand behavior evidence; stage 3 = retention, etc. The machine refuses
  stage-inappropriate work.
- **Habitat**: K's card surface is the founder interface. A shared human+agent channel is
  optional and only if it earns its place; Buzz is open source (Apache-2.0, Nostr) and
  Cloudflare OS is open source and self-hosted — both are candidate habitats, neither is
  adopted yet.

## 5. Stage map with the frontier's evidence

| Stage | Binding constraint | Frontier evidence it can be agent-heavy | Frontier evidence it cannot |
|---|---|---|---|
| 0 Idea | demand reality | Office-hours forcing questions + design doc; research synthesis (AI-native playbooks) | "Mistaking building for validating" — Anthropic's named failure mode |
| 1 Validation | behavior, not interest | Prototypes, landing pages, concierge ops | The ask, the promise, the price |
| 2 First revenue | 1–10 paying customers by hand | Outbox-drafted outreach; invoicing; onboarding; AR chase (Rex class) | Founder-led selling, negotiation, terms |
| 3 PMF | retention and pull | Instrumentation, analysis, support (Klarna-class: ~700 FTE-equivalents) | Reading qualitative signal; product taste |
| 4 Growth | one profitable channel | Content cadence, funnels, experiment ops (Skai-class agent-native marketing) | Channel commitment; brand posture |
| 5 Default alive | runway, margin, reliability | Bookkeeping prep, AP/AR, compliance calendar, support, hiring pipeline | Capital allocation, key hires, pricing |
| 6 Scale | org and capital without losing the thing | Most operational execution (COVU: 2–3x EBITDA; ZHC: +30–80% rev/employee) | Vision, capital, partnerships, public identity |

## 6. Build plan

**Phase A — spine (make the factory run business work).**
1. Business state store + markdown projections; stage machine; single writer/reconciler.
2. Unit type for moves: plan → lanes → gates → review → receipt; reuse the factory's
   state machine patterns (states as code, transitions only through one function).
3. Memory contract: read-before-act, write-after-run, receipts, supersession, retrieval
   enforced at dispatch.
4. Authority: action classes (advise/draft/reversible/irreversible), scoped credentials,
   budgets with hard stops, audit, emergency brake; outbox and cards become instances.

**Phase B — first stations against the live constraint.**
5. `capital` (raise pipeline, deck ledger, data room, investor updates) — Holon's blocker.
6. `money` (cash, AR/AP, close prep, tax/entity calendar, spend; two-approval rule).
7. `gtm` (lead triage, outreach units, pipeline, call prep, proposals; pricing mode).

**Phase C — tools, identity, habitat.**
8. Tool layer: email/calendar read first, then accounting/payments (scoped cards), then
   CRM/analytics; MCP where available, browser fallback; egress registry lines per tool.
9. Agent identity + audit: principals, scoped time-limited credentials, attestation.
10. Heartbeats and routines: daily brief, weekly chief/retro, event triggers, exception
    escalation to cards.

**Phase D — evals and compounding proof.**
11. Stage scoreboard with pre-registered thresholds and kill criteria; held-out checks.
12. Blind-scored role outputs vs expert artifacts; week-0 vs week-N compounding demo;
    only then publish claims (CB v0.2 stays the generic role pack).

**Adopt vs build.** Adopt where the market is ahead and the license is open: Paperclip
(or its patterns) for control-plane primitives if K's factory would otherwise duplicate
org chart/heartbeats/budgets; Buzz or Cloudflare OS only if a habitat is needed; Stripe/
Mercury/Ramp rails for money. Build where K is uniquely deep: sovereign memory, doctrine
with receipts, founder cards, fail-closed gates, labeled egress, review separation.

## 7. Honest limits

- **Zero-human is a lens, not a goal** (ZeroForce's own framing): someone must set
  direction, own regulators and investors, and carry embodied judgment. Humans stay on
  liability, conviction, and trust.
- **The three human surfaces** do not automate: signature/liability, price/conviction,
  relationships/reputation.
- **Goodhart is structural**: any metric visible to the system can be gamed; rulers stay
  founder-authored and outside the loop; held-out checks; no self-grading.
- **Trust is earned in phases** (ZeroHuman Co.'s trust chain; Yuki's autonomy ladder):
  widen the leash only after measured runs, never by default.
- **Markdown memory has a ceiling** (Cognee's warning): plain files break on permissions,
  concurrency, temporal queries; K's substrate discipline is the escape hatch, not a wiki.
- **The frontier's loudest numbers are self-reported.** Treat them as direction, not
  proof; the only proof that matters here is Holon's own stage scoreboard.

## 8. Open decisions

1. **Runtime home — settled 2026-09-23:** separate from K. The engine lives in this
   repo under `runtime/`; Holon runs it locally from `~/ai/holon-hq` with state under
   `data/company/`. K keeps only the skills audit. Borrow Paperclip's
   org/budget/heartbeat patterns where they fit; do not install a control plane.
2. **Habitat now or later.** Recommendation: later. One human is in the loop; adopt
   Buzz/Cloudflare OS only when a second human touches the system.
3. **First station set.** Recommendation: capital, money, gtm — against the live Holon
   motion, with units and review separation from day one (they are the first real test of
   the factory on business work).
