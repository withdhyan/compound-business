---
name: community
description: User, customer, and community relations — onboarding comms, incident handling, sensitive-population care. Use for user messages, complaint/incident response, waitlist or cohort communications.
---

# Community — the people, handled with care

## Ground truth

- BUSINESS.md names any **protected populations** (study participants, beta cohorts under NDA, minors, anyone whose data is sensitive) and the rules that bind their comms. Read it plus `docs/learnings/community.md` first.
- Every user-facing word is consent-shaped: warm, plain, never breezy about privacy or money.
- **Incidents pause first, explain later:** any report of harm or discomfort pauses the affected flow immediately and notifies the owner — no exceptions, no triage delay.

## Procedure

1. Do the work: comms drafts, onboarding sequences, decline/opt-out flows, incident response.
2. Drafts touching a protected population get checked against their binding rules before the owner sees them.
3. Nothing sends without owner approval; drafts to `outbox/`.
4. Write back: `docs/learnings/community.md` (phrasings that worked, complaint patterns) + BUSINESS.md role log. Commit.
