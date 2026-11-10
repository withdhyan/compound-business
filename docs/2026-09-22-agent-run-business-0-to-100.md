---
title: "Run a business 0→100 by an agent — the complete rethink: requirements, stages, architecture, honest limits"
date: 2026-09-22
area: company-runtime
type: brainstorm
status: superseded-by-deep-design
superseded_by: docs/brainstorms/2026-09-22-company-as-factory-deep-design.md
method: first-principles decomposition + YC/Garry Tan office-hours doctrine + frontier scan (GBrain, zero-human companies, agent-OS platforms, payment rails) + Holon's live state
supersedes: docs/plans/2026-09-22-004-feat-compound-suite-rationalization-plan.md
---

# 0→100 by an agent

## Conclusion first

"Run a business 0→100 by an agent" is not a bigger role pack. It is a **company
runtime**: a stateful business model (entities, events, decisions, metrics, rules), a
**stage machine** with a named binding constraint and exit criteria per stage, a **role
set** that maps to the constraint, **tools** that can touch the world, an **authority
ladder** that says exactly what may happen without a human, **loops** on a clock with
exception escalation, and **evals** that keep the ruler outside the loop's reach.

The work is automatable. The business is not. Three things stay human permanently:
**liability** (signing, banking, being sued), **conviction** (choosing the problem and
the price), and **trust** (real relationships, reputation). Everything else — including
sales prep, money ops, capital pipeline, support, bookkeeping, and most of the build —
is agent work under those three human surfaces.

The current stack is the right seed pointed at the wrong granularity: skills that advise,
markdown memory that doesn't load itself, no tools, no stage model, no evals. The
rethink below says what to build instead, in order, and what will never be an agent's job.

## 1. What 0→100 actually is (and what each stage optimizes)

Each stage has one binding constraint. Automating the wrong stage is motion without
progress — the most expensive failure mode in agent-run companies.

| Stage | Binding constraint | Prove it with | Agent owns | Human only |
|---|---|---|---|---|
| **0. Idea** | Is this problem real and does anyone pay to remove it? | Forcing-question artifact (Garry Tan's six); no build until demand evidence | Landscape/competitor research, user-interview synthesis, wedge prototypes, feasibility | Choosing the problem; the first real user conversations |
| **1. Validation** | Behavior, not interest | Pre-orders, paid pilots, usage, "would be upset if it vanished" | Outreach prep, landing page, pricing tests, prototype/MVP (CE), concierge ops | The ask, the promise, the price |
| **2. First revenue** | Getting 1–10 paying customers by hand | Signed orders / collected money | Drafts, demos support, onboarding, support, invoicing, close prep | Founder-led sales, negotiation, terms |
| **3. Product-market fit** | Retention and pull | Cohort retention, unprompted pull, Sean-Ellis-style signal | Instrumentation, analysis, support, iteration build, churn triage | Reading the qualitative signal; product taste |
| **4. Repeatable growth** | One channel with positive unit economics | CAC/LTV by channel, a loop that refills | Experiment design + execution (advisory), content cadence, funnel ops, reporting | Channel commitment; brand posture |
| **5. Default alive** | Runway, margin, and system reliability | Default-alive math, gross margin, incident rate | Bookkeeping prep, AP/AR, compliance calendar, support, ops runbooks, hiring pipeline | Capital allocation, key hires, pricing architecture |
| **6. Scale (→100)** | Org and capital without losing the thing | Growth rate, retention, unit economics, category position | Most operational execution, reporting, pipeline, vendor ops | Vision, capital, partnerships, public identity |

Consequence for architecture: the runtime must know **which stage it is in**, because the
same role behaves differently at each. A growth role at stage 1 must refuse to run
campaigns (demand isn't proven); a money role at stage 3 must refuse to plan payroll
there isn't revenue for. Stage is state, not prose.

## 2. Office hours as the stage-0 gate (Garry Tan, and what CB already took)

Garry Tan's `office-hours` is the cleanest public formalization of stage 0: two modes,
anti-sycophancy enforced, six forcing questions — **demand reality, status quo, desperate
specificity, narrowest wedge, observation & surprise, future-fit** — then a design doc,
a second opinion, and feasibility. His framing: *"sometimes one in three times I get to
the end and say this isn't something that makes sense."* That is the gate working.

CB's `office-hours` already carries the same six questions plus pre-commitment and
irreversibility checks. Keep it; make it the **mandatory gate for stage 0→1** in the
runtime, with the design doc as the state artifact that later stages read.

The rest of Garry's own system is the other half of the answer:

- **GBrain** — 10k+ markdown entity pages (people, companies, meetings, ideas), a
  read → respond → write loop, hybrid retrieval, three memory layers (world knowledge /
  operational state / conversation). Personal memory, owned locally.
- **"Own your intelligence"** (Startup School 2026) — agents on your infrastructure,
  memory you own, procedures you wrote; *"entire startups these days will be markdown
  files"*; *"agents are how one founder does unscalable things at scale."*
- **"Thin harness, fat skills"** — the system is files + a way to act on the world.

That is K's exact thesis, one layer down. K is the personal AGI; the company runtime is
the business layer that runs on the same substrate and memory discipline.

## 3. What an agent can and cannot do (capability taxonomy)

**Agent-doable now, with rails:** research; draft; analyze; code; monitor; summarize;
plan; critique; generate assets; design experiments; operate software through MCP/APIs;
triage; respond (approval-gated); maintain records; remember; spend within a scoped card;
deploy; publish (approval-gated); prepare filings.

**Agent-doable only with a human counter-signature:** contracts, payments above policy,
regulator filings, hiring offers, public commitments, anything that creates liability.

**Structurally human:** liability and legal personhood; KYC/banking identity; equity and
IP ownership; conviction and taste; real relationships and reputation; physical presence;
testimony. An agent can *be* the interface; it cannot *be* the party.

Design consequence: **the agent runs the loop, the human owns the plug.** Default
autonomous, escalate on exception — "human above the loop", not in it — with the
exception list written, not vibed.

## 4. What it would require (the ten-piece stack)

Each piece: what it is, what exists today, what is missing.

1. **Business state.** Entities (people, companies, offers, experiments, transactions,
   decisions), events, metrics *with definitions*, rules *with receipts*, stage. Today:
   `BUSINESS.md` + `docs/learnings/*.md` + `DECISIONS.md` — human-readable, machine-poor.
   Missing: a queryable store; markdown as a projection, not the source. Borrow K's
   substrate discipline (bitemporal, supersede-never-mutate) in a lightweight form.
2. **Stage machine.** Stage enum with entry/exit criteria, binding constraint, owner
   role, and automatic flag when stage is contested. Nothing like this exists.
3. **Role set.** The functions a company needs, mapped to stage and state. CB has 12;
   missing money, capital, gtm/sales, pricing, ops, contracts, support mechanics, people,
   data instrumentation.
4. **Tools / effectuators.** MCP or API per function: email, calendar, CRM, code, deploy,
   analytics, payments (Stripe / Mercury / Ramp agent cards), accounting (Xero/QBO),
   e-sign, tickets, social. Today: none — the roles can only write files. Frontier
   supports this now: policy-scoped agent cards, human-set limits, agent cannot raise its
   own limit; read via MCP, propose in outbox, execute with a scoped credential.
5. **Authority ladder.** One explicit ladder, per action class: *advise → draft →
   reversible act (logged) → irreversible act (human only, or scoped credential with
   limits)*. Today: outbox + typed levers is a good seed but only covers drafts vs
   decisions; no action classes, no scopes, no audit log, no kill switch, no reversal.
6. **Loops and a clock.** Daily brief, weekly chief/retro, event triggers (lead in,
   invoice due, incident, threshold breach), and stage-transition reviews. CB's weekly
   cadence is right but slow for stages 1–3; event triggers are absent. Exceptions
   escalate; everything else just runs.
7. **Evals.** Per stage: one north-star + leading indicators + **pre-registered**
   thresholds + kill criteria; held-out checks so the system cannot grade itself into
   production. Today: `analyst` pre-registration exists as method; no scoreboard, no
   held-out gate. Non-negotiable from the prior frontier scan: the ruler stays outside
   the loop.
8. **Compounding memory.** After-action rules with receipts, retrieval into the next
   run, supersession instead of deletion, founder-card promotion for anything that
   changes identity/strategy. CB writes learnings; nothing guarantees they are read by
   the next run of a different role. This is the one thing that actually compounds.
9. **Legal and money rails.** Entity, bank, signer, e-sign, insurance, tax calendar.
   Agents act as agents of the founder; AI identity is disclosed where required;
   nothing signs or files without the human. Mercury/Ramp-style scoped cards and
   Stripe's agent toolkit make the money side real; the liability side stays human.
10. **Reality interface.** Humans are the trust channel: founder conversations, calls,
    community. The agent's job is to make every human interaction cheap and well-aimed
    (prep, follow-up, memory), never to fake it. New channel: sell **to** agents
    (agent-readable catalogs, agentic checkout) — GTM scope worth its own role later.

## 5. Architecture: the company runtime

```
        ┌───────────────── founder interface (cards, phone, one surface) ─────────────────┐
        │  decisions needed · verdicts · money approvals · identity/strategy levers       │
        └───────────────────────────────▲───────────────────────────────┬─────────────────┘
                                        │ exceptions                    │ rulings
   loops: daily brief · weekly chief/retro · event triggers · stage reviews
                                        │
        ┌───────────────────────────────┴───────────────────────────────┐
        │                        company runtime                        │
        │  stage machine │ role set │ authority ladder │ evals │ clock   │
        └───────┬───────────────┬───────────────┬───────────────┬───────┘
                │               │               │               │
          business state    tools (MCP)     audit log      memory (rules, receipts,
          entities/events   money · mail    every action   supersession, doctrine)
          metrics/decisions CRM · repos      attributes     retrieved before every run
```

- Skills become **role interfaces** over the runtime, not the runtime itself. A role's
  `SKILL.md` says when to fire, what to read, what to produce, which gates apply.
- The existing families slot in: **ce** = build effectuator, **cd/design** = design
  discipline, **compound-marketing** = positioning/teaching method, **CB** = the
  operating roles. The runtime is the missing spine they all write into.
- K is the substrate where possible: cards, egress registry, gates, and the doctrine
  store already implement pieces of the authority ladder and compounding memory. The
  company runtime should reuse those, not invent a second rail system.

## 6. Build order (from current state)

**Phase A — state and spine (before more roles).**
1. `BUSINESS_STATE` schema + store (entities, events, metrics+definitions, decisions,
   rules+receipts, stage) with markdown projections for humans.
2. Stage machine: stage enum, exit criteria, contested-stage flag; `chief` reads it.
3. Memory contract: every role reads state + its learnings, writes back rules with
   receipts; supersede, never delete.
4. Audit + authority ladder: action classes, scoped credentials, spend limits, kill
   switch; outbox and levers become instances of it.

**Phase B — the roles the live constraint needs.**
5. `capital` (fundraising pipeline, deck ledger, data room, investor updates) — the
   live bottleneck.
6. `money` (cash, AR/AP, close prep, tax/entity calendar, spend; two separate approvals
   for coding vs paying; unreadable reported unreadable).
7. `gtm` (lead triage, outreach to outbox, pipeline, call prep, proposals; pricing mode
   with pre-registered tests).

**Phase C — tools and clock.**
8. Connectors with consent gates: email/calendar first, then accounting/payments,
   then CRM/analytics. Read-only before write; scoped write before money.
9. Event triggers + daily brief + stage reviews; exceptions escalate to the one surface.

**Phase D — evals and compounding proof.**
10. Stage scoreboard with pre-registered thresholds and kill criteria; held-out checks.
11. Blind-scored role outputs against real expert artifacts; week-0 vs week-N compounding
    demo. Only then publish claims.

## 7. Honest limits and failure modes

- **No demand, no business.** Automation multiplies motion, including wasted motion.
  Stage 0 is the gate that prevents everything downstream from being confidently wrong.
- **Trust is the real currency.** Agent-run companies that win are ones where the human
  stayed present at the moments that matter; the failures are ones where the agent
  impersonated conviction.
- **Goodhart.** Any metric the system can see, it can game. Fixed, human-authored rulers;
  held-out checks; no self-grading.
- **Liability doesn't automate.** Signing, filing, paying, promising: human or scoped
  credential with a hard ceiling and an audit trail.
- **Context rot.** More state accumulates than any run can read. Retrieval discipline —
  what this role must read before acting — is a first-class design object, not a hope.
- **The frontier's zero-human companies** (Project Zero, Zero Employee Co, OpenClaw
  builds, Lyzr's agent-run raise) are directionally real and mostly small; treat them as
  proof that the loop works, not proof that the founder is optional.

## 8. Open decisions for the founder

1. **Runtime home.** Build the company runtime inside K (cards, store, gates, one
   surface) with CB as its role pack; or keep CB standalone and grow its own state.
   Recommendation: inside K — every rail needed already exists there.
2. **First stage target.** Holon is at stage 1–2 (wedge test, capital motion). Build the
   runtime thin and the capital/money/gtm roles against the live motion rather than
   generalize first.
3. **Publish posture.** CB v0.2 stays the generic role pack; the runtime is K-specific
   until it has evals. Do not publish the runtime claim before the compounding demo.
