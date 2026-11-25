---
tags: [pr-create]
plugins: [../../../skills/pr-create, ../../../skills/branch-flow, ../../../skills/azdo-cli, ../../../skills/commit]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Apri la PR. Contesto già verificato, non serve controllare: remote su dev.azure.com, branch
feature/export-pdf, un solo commit "Aggiungi export PDF del report mensile". Né il nome del branch né
il commit contengono un id di work item, e non c'è nessun `AB#` da nessuna parte.
