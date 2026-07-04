# CB — Compound Business

**Business role skills with a memory that compounds.** The business version of [compound engineering](https://every.to/guides/compound-engineering): a team of AI business roles — strategist, marketer, counsel, analyst — where every run reads the rules learned before it and writes back what it learned. No lesson is paid for twice.

Role packs for agents exist (Anthropic's knowledge-work plugins, marketing skill packs, GTM agent fleets). They're all stateless: week five's agent doesn't know what week two's learned. CB's whole bet is the loop:

```
/office-hours (interrogate the move)
      ↓
/chief (queue the week, enforce gates)
      ↓
roles execute (drafts → outbox/ → the human sends)
      ↓
/analyst (measure against pre-stated thresholds)
      ↓
/retro (audit last week's rules ✅/⏳/❌, extract ≤3 new, prune dead)
      ↺ next week starts smarter
```

## Install

CB is a Claude Code plugin (plain-markdown skills; portable in principle to other harnesses).

1. Add this repo as a plugin (or copy `skills/` into your project's `.claude/skills/`).
2. Run `/cb-init` in your project. It seeds the memory layer CB runs on:
   - `BUSINESS.md` — the live dashboard every role reads first and writes back to
   - `STRATEGY.md` — what you're building, for whom, your standing rules (CB reads it; you own it)
   - `docs/learnings/<role>.md` — per-role rulebooks, written by `/retro`
   - `outbox/` — nothing external ever sends without you
3. Work. `/chief` on Mondays, `/retro` on Fridays, roles in between.

## The roles

| Skill | Job |
|---|---|
| /cb-init | One-time: seed the memory layer in your repo |
| /office-hours | Forcing-question interrogation of any move BEFORE you commit to it |
| /chief | Weekly synthesis; queues the week; enforces your standing rules; verdict: READY / NEEDS WORK / NOT READY |
| /brand | Naming, positioning, one-liners, voice |
| /growth | Funnel, channels, experiments — every experiment pre-registers its kill threshold |
| /content | Public writing in your voice, with a leak check against whatever you've declared quiet |
| /community | User/customer comms, incident handling |
| /partnerships | Partner and grant pipeline, meeting prep with red lines |
| /counsel | Privacy/compliance review — binary SHIP / FIX verdicts; can block a feature |
| /analyst | Metrics vs. pre-committed thresholds; measured ≠ estimated ≠ assumed, loudly |
| /retro | The compounding ceremony: audit, extract, prune |
| /new-role | CB grows itself — new roles via skill-TDD (baseline failure → write → pressure-test → deploy) |

## Non-negotiable rails (built into every role)

- **Outbox discipline.** No tweet, email, or DM leaves without the human. Drafts land in `outbox/`.
- **Read-first contract.** Every role reads `BUSINESS.md`, `STRATEGY.md`, and its own learnings file before acting.
- **Write-back contract.** No run ends without updating the dashboard and logging durable lessons.
- **Verdicts, not vibes.** Gates close with READY/NEEDS WORK/NOT READY or SHIP/FIX — never narrative.
- **Humans decide.** CB recommends; cross-model or cross-role agreement is a signal, never permission.
- **Levers are typed.** `DECISIONS.md` registers every decision as LEVER (owner only, after discussion), JUDGMENT (agent decides, logs, flags), or MECHANICAL (silent). The test is blast radius and inheritance, not file reversibility — and /chief audits for levers taken silently, every run.

## Status & maintenance posture

- **v0.1.** Extracted from a real company run day-one on CB (its first proof is being built in public — the network launch it's running will be linked here).
- **Canonical harness: Claude Code.** Ports to other harnesses are welcome as community-maintained; "supported" means the Claude Code path.
- **Before v1.0:** published benchmark evals (role output blind-scored against real expert artifacts) and a compounding demo (the same task at week 0 vs. week N of learnings, diffed). Claims will not outrun artifacts.

MIT. Built with compound-engineering discipline; gstack, Superpowers, and BMAD are acknowledged influences on the enforcement patterns.
