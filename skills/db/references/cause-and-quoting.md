# db-analyst — client fallbacks and `db-ro.ps1` quoting

The `db-analyst` agent keeps its rules, hosts, steps, Cause table and output shapes in its own body;
the lookups it needs only on some paths live here, one section each.

## Clients

Client not installed: inside the project's container, `docker compose exec <db-service> <client> …`.

## Quoting

Write the `db-ro.ps1` path exactly as above, literal `~` in either shell: the allow rule in
`settings.json` matches the command text, so `$HOME\...` would prompt. Pass the SQL or redis command in
**single quotes**, a quote inside it doubled (`'WHERE n = ''a'''`): the hook asks on any `$`, backtick,
`(`, `@` or `<` outside single quotes, so a double-quoted or bare query can prompt.
