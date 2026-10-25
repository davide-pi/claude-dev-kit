---
tags: [grill-me]
plugins: [../../../skills/grill-me, ../../../skills/deliver, ../../../skills/plan-work]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Fammi le pulci al design: una sola coda per le notifiche, un solo consumer, retry infinito in caso di errore.
