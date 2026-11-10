---
name: amplify
description: Turn a seed idea into a ranked ×100 portfolio and build the winners. Use when the founder drops an idea ("amplify this", "what could this become"), when mined ideas are waiting in the seed queue, or on the routine pass that checks for new seeds.
---

# /amplify — one line in, a portfolio out

The founder's job is the idea; yours is the ×100 — develop it into real
directions, evaluate honestly, and take the winners into build. You are not a
cheerleader: a killed idea with a reason is a good outcome.

## Ground truth

- Ideas are records, not notes. All state goes through the engine:
  `node runtime/cli.mjs [--data <dir>] …` (see `runtime/README.md`).
- Read before amplifying: `BUSINESS.md`, `STRATEGY.md`; then per task
  `cb get "<the idea's topic>"` for standing rules and prior verdicts (they are
  priors), `cb show` the hits you use, and write verdict lessons with
  `cb propose` (see /retro for the proposal shape).
- The miner (`mine --config sources.json`) already stages seeds from configured
  history. Auto-run is a scheduled `mine`; evaluation and amplification run when
  the agent next checks the queue.
- Advisory only. Nothing external sends; build goes through the unit machine.

## Procedure

1. **Intake.** Given an idea, record it:
   `idea add "<one line>" [--source …]`. Otherwise pull the queue:
   `idea list --status seed`.

2. **Evaluate cheap first.** Score each seed 0–10 on `pull` (evidence on record,
   not vibes), `fit` (founder's unfair advantage), `novelty`, `feasibility`,
   `alignment` (standing rules); verdict `amplify` / `park` / `kill` with a one-
   line reason. Score from what is on record; when unsure, score lower.
   `idea evaluate <id> --file eval.json`. Never amplify on a `kill`.

3. **Amplify ×100.** For each idea that earns it, produce ~10 variants across
   *different angles* — customer, wedge, business model, distribution, first
   build, form factor. Each variant: `title`, `angle`, `oneLiner` (≤15 words),
   `firstBuild` (the smallest thing to ship this week), `why10x` (the mechanism,
   not the adjective), optional `rank`. A list of near-duplicates is a failed
   amplification; cut it and write fewer, sharper variants.
   `idea amplify <id> --file variants.json`.

4. **Present the portfolio.** Ranked, one line each, and exactly one
   recommendation: the two or three you would bet on and why. No essays.

5. **The founder picks.** `idea decide <id> --variant "<title>" [--variant …]
   [--note "…"]`. Rejections are memory — note them.

6. **Build.** Each chosen variant becomes a unit through the engine: owner role,
   review role (never the same), authority class, `actionScope` when reversible
   or irreversible, evidence, kill criterion. Then run it through the unit
   machine (`planned → approved → running → review → shipped`) with review by a
   different role. Report unit ids, not narrative.

7. **Write back.** Durable rules and what the founder actually picked/rejected
   and why → `docs/learnings/amplify.md`; one role-log line in `BUSINESS.md`.

## Rails

- Never reopen a killed idea without new evidence; say what changed.
- The founder decides. Agreement between you and a reviewer is a signal, never
  permission.
- No external sends, no spend, no publishing from this skill.
- One idea at a time to a finished portfolio; do not batch ten shallow ones.
