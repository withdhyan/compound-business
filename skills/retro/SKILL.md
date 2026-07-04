---
name: retro
description: Weekly business retrospective — what shipped, what was learned, what compounds. Use for "run retro", end of week, or after any launch/milestone. Backward-looking counterpart to /chief (which queues the week ahead).
---

# Retro — the compounding ceremony

/chief looks forward; /retro looks back. This is where the week's experience becomes permanent stack knowledge — the explicitly compounding step. A stack without retros is a stateless role pack.

## Procedure

1. Gather what actually happened: `git log --since='1 week ago' --oneline`, BUSINESS.md role log, every `docs/learnings/*.md` entry from the week, outbox sends.
2. **Follow-through audit (before anything new — the accountability loop):** load the previous retro's rules and open action items; mark each ✅ applied / ⏳ in progress / ❌ ignored. An ignored rule gets one question: still right (re-commit, say what blocked it) or wrong (prune it, note why)? A retro that only adds and never audits doesn't compound — it accumulates.
3. Per active role, three questions:
   - What did we predict / what happened? (Check every experiment against its pre-stated threshold.)
   - What would we do differently — as a RULE, not a regret?
   - What learned rule is now stale or disproven? (Delete it from the learnings file, note why — pruning is compounding too.)
4. Extract at most 3 durable rules for the week. A rule must be operational ("never send customer comms on Fridays; replies spike unseen over weekends"), not a platitude.
5. Write back: rules to the owning role's learnings file; BUSINESS.md role log line; anything that changes standing strategy gets flagged to the owner rather than silently edited.
6. Commit with message `retro: week of <date>`.

## Output format

Follow-through audit (✅/⏳/❌) → Shipped → Predicted vs. happened → New rules (≤3) → Pruned rules → Flag for owner (if any). Terse.
