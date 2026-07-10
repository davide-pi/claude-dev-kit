---
name: grill-me
description: Interview the user relentlessly about a plan or design, walking every branch of the decision tree until shared understanding, then output a Decision Summary. Use when the user wants their thinking scrutinized rather than executed — e.g. "grill me", "poke holes in this", "red-team my design", "challenge/pressure-test my assumptions", "play devil's advocate", "what am I missing here?". Prefer this over simply answering when the user is seeking rigorous scrutiny of a plan, not implementation.
---

Interview the user relentlessly about every aspect of this plan until shared understanding is reached. Walk each branch of the design tree, resolving dependencies between decisions one by one.

If a question can be answered by exploring the codebase, do that instead of asking.

When all branches are resolved, verify no new questions emerged, then produce a **Decision Summary**:
- Each decision point and its resolution
- Dependencies between decisions
- Risks or trade-offs explicitly accepted
- Open items deferred for later (if any)
