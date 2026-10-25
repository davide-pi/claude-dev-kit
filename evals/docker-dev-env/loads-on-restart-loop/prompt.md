---
tags: [docker-dev-env]
plugins: [../../../skills/docker-dev-env, ../../../skills/sql-server]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Il container di sql server non parte, si riavvia in loop.
