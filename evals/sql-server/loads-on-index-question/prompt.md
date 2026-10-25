---
tags: [sql-server]
plugins: [../../../skills/sql-server, ../../../skills/ef-core, ../../../skills/docker-dev-env]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Che indice serve a questa query? SELECT * FROM Orders WHERE CustomerId = @id AND Status = 3 ORDER BY CreatedAt DESC
