---
name: new-role
description: Use when CB needs a new business role skill, when an existing role keeps failing the same way, or when the owner says "add a role for X". Creates or hardens CB skills using skill-TDD — never ships an untested skill.
---

# New role — CB grows itself (skill-TDD)

Writing skills is TDD applied to process documentation. A skill written from imagination is untested code in production.

## When NOT to create a role

- One-off task → just do it in the main loop.
- Mechanical constraint enforceable with a check → automate it; save skills for judgment calls.
- Overlaps an existing role → extend that role's SKILL.md instead. Ten sharp roles beat twenty mushy ones.

## Procedure

1. **RED — capture the failure first.** Write down the concrete scenario where the stack currently fails (what was asked, what went wrong, what right looks like). If you can't name a real failure, you don't need the role yet.
2. **Baseline test:** give the scenario to a subagent WITHOUT the new skill. Record how it fails — verbatim. This failure text is the rationalization table's raw material.
3. **GREEN — write the skill**, following the CB template (Ground truth → Procedure → write-back to BUSINESS.md + docs/learnings/<role>.md + commit). Authoring rules:
   - **Description = WHEN to use, never what it does.** Agents follow workflow summaries in descriptions instead of reading the skill body. Include the symptoms/phrases that should trigger it.
   - **Match the form to the failure:** skips a rule under pressure → prohibition + rationalization table + red flags; complies but output is wrong-shaped → positive recipe/output contract (NOT a prohibition list); omits an element → required structural slot. Don't mix forms; don't append nuance clauses to a working recipe.
   - Standing rails every role inherits: outbox discipline, read-first contract, verdict-style gates where the role gates anything.
   - Keep it under ~150 lines; deep material goes to `references/` loaded on demand.
4. **Verify:** rerun the scenario with the skill loaded. Not fixed → tighten wording, close the specific loophole verbatim ("violating the letter is violating the spirit"), rerun. Fixed → done.
5. **Deploy one at a time.** Never batch-create untested skills. Write back: the RED scenario and the wording that finally worked to `docs/learnings/chief.md`; BUSINESS.md role log. Commit.
