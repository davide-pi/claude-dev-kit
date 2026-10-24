---
tags: [docker-dev-env]
plugins: [../../../skills/docker-dev-env, ../../../skills/sql-server]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Questa query postgres è lenta, leggi l'EXPLAIN: Seq Scan on orders (cost=0.00..18334.00 rows=1 width=8) Filter: (customer_id = 42)
