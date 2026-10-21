---
tags: [rabbitmq]
plugins: [../../../skills/rabbitmq, ../../../skills/docker-dev-env, ../../../skills/dotnet-backend]
runs: 2
max_turns: 4
allowed_tools: [Skill]
disallowed_tools: [Agent, Read, Glob, Grep]
---
Questo consumer riprocessa lo stesso messaggio due volte.
