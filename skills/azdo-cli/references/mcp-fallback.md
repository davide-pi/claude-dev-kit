# The MCP fallback — when the CLI genuinely cannot reach

The rule is one sentence: **try the CLI first, every time, and fall back only on a gap you have
identified.** This file exists so the fallback is a decision with evidence behind it, not a habit.

## Why the CLI is first, and not a matter of taste

| Property | `az` | MCP |
| --- | --- | --- |
| Verbs and flags | discoverable with `--help`, in the shell, now | discoverable only by reading a tool schema |
| Surface stability | the extension's verbs change slowly | tool names get consolidated and renamed between server versions |
| Reproducibility | the exact command can be pasted into a script, a pipeline or a hand-off | a tool call cannot leave the session |
| Availability | one binary, one credential | needs the server configured, connected and pointed at the right organization |
| Cost | one process | a tool schema in the context window for every tool the server exposes |

The last row is the one that decides it. An MCP server's whole tool surface sits in the context
window whether or not it is used; a CLI command costs a line of shell.

## The three tests, in order

Before any fallback, all three have to fail:

1. **Is there a verb?** `az <group> --help`, then `az <group> <verb> --help`. A missing *flag*
   almost always means the wrong verb, not a gap — check `Commands:` and `Subgroups:` again.
2. **Can `az devops invoke` reach it?** Any Azure DevOps REST endpoint is reachable with the
   credential already configured. Run `az devops invoke` with no `--area`/`--resource` once to list
   every area and resource the organization exposes, and use that listing to confirm the names and
   route. This is still the CLI.
3. **Is the route verifiable?** If the area, resource or route parameters cannot be confirmed from
   that listing, stop. Guessing a REST route is worse than falling back — a wrong route on a `POST`
   writes the wrong thing.

Only when all three fail is it a gap.

## The gap list, with its counterpart

| Gap | Why the CLI cannot | The fallback |
| --- | --- | --- |
| A project's work item types, their states and their fields | no verb; reachable through `invoke` on the `wit` area | MCP work-item type read — it also returns the field set a create must respect |
| Read a work item's discussion | `--discussion` writes only; no read verb | MCP work-item read with comments |
| Attach a file to a work item | no verb; the REST path is a two-step upload plus relation | MCP attachment tool — one call, no half-done attachment |
| PR comment threads: read, post, reply, inline anchor, resolve | no verb anywhere under `az repos pr` | MCP PR-thread tools — they model the file, line range and iteration an inline thread needs |
| A pipeline run's step logs | no verb; reachable through `invoke` on the `build` area | MCP build-log tool |
| Full-text search over code, wiki or work items | no verb, and no stable REST surface worth driving by hand | MCP search tools |
| A file's content at a ref, with no clone | no verb | `git show <ref>:<path>` in a clone; MCP repo-file tool otherwise |
| Backlog levels and board columns | no verb | MCP backlog tool |
| Resolve a display name to an identity id | `az devops user list`/`show` covers organization members only | MCP identity tool |

Everything not in this table has a CLI path. If you believe you found a new gap, add the evidence —
which group's help you read and which verb was absent — before treating it as one.

## Using the fallback well

- **Say so, once.** One line in chat: which capability, which route was tried, which tool was used.
  A silent fallback is how CLI-before-MCP quietly stops being true.
- **Match by capability, never by name.** These servers consolidate their surface over time: reads
  and writes that were separate tools end up behind one name plus an `action` parameter. Read the
  schema of the tool you are about to call; if a name you remember is gone, find the tool with the
  same capability and use it. Never invent a tool name, and never abandon a step because the name
  you remembered no longer exists.
- **Pick the right server.** Several servers may be connected. Two pointing at the same organization
  are interchangeable — take the first. Two pointing at different organizations is a choice: pick
  the one matching the organization the work belongs to, and ask if that cannot be derived.
- **Fall back for one step, not for the flow.** A PR review that needs MCP for threads still uses
  `az repos pr show` and `az repos pr list` for everything else. Do not switch the whole task to MCP
  because one step needed it.
- **Discover, do not assume.** Organization, project, types and states are read at runtime whichever
  route you take. A fallback is not a licence to hardcode.

## What the fallback never buys you

A gap in the CLI is not permission to skip the parts of a flow that exist to be careful: an MCP
write is exactly as irreversible as a CLI write. A work item created, a comment posted, a PR
completed, a run queued — all of them are visible to other people the moment they land, and the
confirmation the owning asset requires still applies.
