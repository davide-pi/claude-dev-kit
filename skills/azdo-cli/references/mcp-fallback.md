# The MCP fallback — when the CLI genuinely cannot reach

The rule is one sentence: **try the CLI first, every time, and fall back only on a gap you have
identified.** This file exists so the fallback is a decision with evidence behind it, not a habit.

Why CLI first: `az` verbs are discoverable with `--help` and reproducible outside the session, and `--query`
trims the result; an MCP result arrives untrimmed and every `azdo-*` call prompts the user.

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

## The gap list — the single owner

Every other asset in the kit points here instead of keeping its own list. Only these are gaps:

| Gap | Why the CLI cannot | The fallback |
| --- | --- | --- |
| A type's **field set** — which fields a create on that type accepts | the `fields` resource lists the project's fields, not cleanly per type | MCP work-item type read |
| Full-text search over code, wiki or work items | no verb, and no stable REST surface worth driving by hand | MCP search tools |
| Backlog levels and board columns | no verb | MCP backlog tool |
| A file's content at a ref, with no clone | no verb | `git show <ref>:<path>` in a clone; MCP repo-file tool otherwise |
| Resolve a display name to an identity id outside the organization's members | `az devops user list`/`show` covers members only | MCP identity tool |

If you believe you found a new gap, add the evidence — which group's help you read, which verb was
absent, and why no `invoke` route could be verified — before treating it as one.

## Not gaps — the CLI reaches them, do not fall back

| Looks like a gap | The CLI route | Where |
| --- | --- | --- |
| A project's work item types and their states | `invoke --area wit --resource workItemTypes` / `workItemTypeStates` | `work-item-roles.md` |
| Reading a work item's discussion (`--discussion` only writes) | `invoke --area wit --resource comments` | `boards-catalogue.md` |
| A pipeline run's step logs | `invoke --area build --resource Timeline`, then `logs` | `pipelines-catalogue.md` |
| PR comment threads: read, post, reply, resolve | `invoke --area git --resource pullRequestThreads` (and `pullRequestThreadComments`); the MCP PR-thread tools are accepted only when an inline anchor's thread context cannot be verified | `repos-and-prs.md` |
| Attaching a file or an image to a work item | two REST calls with the current `az login` token — no PAT | `workitem-content.md` |
| Wiki page writes, and listing a wiki's page tree | REST (the write verbs corrupt accents; there is no `list` verb) | `wiki-rest.md` |

## Using the fallback well

- **Say so, before the call.** The `azdo-*` servers are behind an `ask` permission, so the user is
  prompted anyway: one line in chat first — which capability, which CLI route failed, which tool
  comes next — turns the prompt into an informed yes.
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

A gap is no licence to skip care: an MCP write is as irreversible as a CLI write, and the owning asset's
confirmation still applies.
