---
name: cb-init
description: Use once, when installing CB into a project that doesn't yet have BUSINESS.md, docs/learnings/, or outbox/ — seeds the memory layer every CB role runs on. Also use to repair a partial install.
---

# cb-init — seed the memory layer

CB roles fail without their memory files. This skill creates them, idempotently — never overwrite an existing file.

## Procedure

1. Check what exists: `BUSINESS.md`, `STRATEGY.md`, `docs/learnings/`, `outbox/`. Report found/missing.
2. For each missing piece:
   - `BUSINESS.md` from `templates/BUSINESS.md` (in this plugin) — fill the current-state section by asking the user 3 questions max, verbatim: "What are you building, in one sentence?" / "What stage — and what's blocked on what?" / "What are your standing rules — things you've decided never to do, thresholds you've pre-committed to?" Leave the metrics/decisions placeholders in the template as-is — /analyst and /chief fill them on their first runs (the template's role-log line covers step 4's logging for this run).
   - `STRATEGY.md`: check whether `/ce-strategy` is actually invocable (it appears in the available-skills list); if yes, recommend it (its interview is better). Otherwise seed a stub with Target problem / Approach / Who it's for / Key metrics headers and mark it DRAFT.
   - `docs/learnings/README.md`: one paragraph explaining the rulebook convention (one file per role; skills read theirs before acting, append after; prune disproven rules with a note).
   - `outbox/`: create with a README line: "Drafts for anything external. Nothing here sends itself."
3. If the repo isn't git-initialized, offer `git init` — commit hashes are CB's timestamps.
4. Write one line to BUSINESS.md's role log: `<date> · cb-init · memory layer seeded`. Commit.
5. Close with: run `/chief` to set the first week's queue.
