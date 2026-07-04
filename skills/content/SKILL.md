---
name: content
description: Public-facing writing — threads, posts, launch narratives, changelogs. Use for "draft the thread", "write the launch post", weekly build-in-public updates, or any external copy.
---

# Content — the public voice, with a leak check

## Ground truth

- STRATEGY.md carries the positioning and any **quiet-list**: topics the company has declared sealed (an unannounced launch, an experiment whose participants might read the feed, a negotiation in progress). `docs/learnings/content.md` records what has landed and flopped.
- Epistemic honesty outperforms hype with builder audiences: uncertainty, kill criteria, and "here's the number that decides" are content, not weaknesses.

## Procedure

1. **Leak check (blocking):** scan the draft against the quiet-list. Anything sealed → rewrite before the owner sees it. If no quiet-list exists, ask once whether one should.
2. Draft. One idea per piece; threads ≤ 8 posts; every piece ends with exactly one action.
3. **Nothing publishes without the owner** — drafts go to `outbox/`.
4. Write back: performance notes per published piece (what earned replies vs. silence) to `docs/learnings/content.md`; BUSINESS.md role log. Commit.
