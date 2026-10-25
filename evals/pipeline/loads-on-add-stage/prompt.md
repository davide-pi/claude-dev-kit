---
tags: [pipeline]
plugins: [../../../skills/pipeline, ../../../skills/docker-dev-env]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Aggiungi uno stage di test alla pipeline Azure DevOps in .pipelines/build.yml.
