# code-reviewer — rare branches

The `code-reviewer` agent keeps passes 0, A–H, the Effort baseline and the Drop rules in its own
Method; the branches it needs only sometimes live here, one section each.

## 1 Get the change

Skip lockfiles, `*.min.*`, `dist/`, `__snapshots__/`, `*.Designer.cs`, `*ModelSnapshot.cs`, `*.g.cs`; never a manifest or a migration `.cs`. Previous findings: fixed → `done`, still there → `todo`, same anchor

## Effort

Effort `high`, `xhigh`, `max`: each adds depth to `medium`.

| Effort | Passes |
| --- | --- |
| `high` | + `blame`/`log` on touched lines, contradicted comments and tests, propagation one hop further |
| `xhigh` | + earlier PRs on the same files; error paths, retries, idempotency; threat model per new entry point |
| `max` | + try to falsify every candidate by re-reading the code; keep the survivors |
