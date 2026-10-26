# Cockpit — design rules

What the pane shows, tab by tab, is the README's "Cockpit mod" section. This page holds the rules every
change to `mods/cockpit/` keeps, and the options already tried and dropped.

## Rules

1. **Zero model tokens.** Everything is computed locally from harness events, `session.usage()` and local
   files. No hook injects context or calls the model. Only the buttons a person presses spend anything:
   `compact`, `log hours`, the exact context count behind `refresh`.
2. **Nothing faked.** A value the engine does not give is left out. A value not measured yet in a new
   session is the last known one, drawn with a dim `~`. An estimate is marked as an estimate.
3. **Nothing submitted on the person's behalf.** A note is sent with `prompt.fill`, never `prompt.submit`:
   the person decides when a turn starts.
4. **Cheap while open, nearly idle while closed.** The fast tier runs only while a tab that draws elapsed times
   is selected, the medium tier (git) only while the pane is open. While the pane is closed the slow tier only
   updates the agents' list while one runs or a permission waits; the heartbeat, the ALM line, git and the worklog
   wait for the pane to open (`hooks/refresh.ts`).
5. **Fixed width.** Content is at most 60 columns plus a margin of one on each side. Rows truncate (only a name
   or description is cut, with `…`), and every view is tested at narrow and wide widths.
6. **Two languages, one file.** Every text is in `hooks/strings.ts` in English and Italian. The language is read
   from `~/.claude/cockpit.json`, which the install never touches.
7. **An alert fires once per episode.** It is raised again only after its cause has cleared, and nothing a
   session was resumed with counts as news.
8. **Files under 600 lines.** Split along a seam that already exists, as pure moves with the same test count.

## Engine facts the code depends on

- `skill.prompt` and the `classic.*` events (`SubagentStop`, `PermissionRequest`, `Notification`, `Stop`) are
  consumed by a managed plugin before the user tier, so they never reach the mod. It derives the same data from
  events that do arrive: skills from `tool.call` on `Skill`, a permission wait from `tool.check`, the workflow
  run from `agent.spawn` (`e.workflow`). A test dispatches none of the classic events and checks all three.
- `usage({ breakdown: 'full' })` spends one token-count request per tool and memory file. It runs when the
  Context tab opens (at most once every 15 s) and on `refresh` (one-minute cooldown), never on every read.
- The engine places a pane opened unasked only from 144 columns; `/cockpit` places it at any width.

## Tried and dropped

| Option | Why not |
| --- | --- |
| a `$` cost per subagent from a hard-coded price list | the list needs syncing by hand; the share of tokens gives the same signal |
| a system tab (CPU, RAM, network, processes) | not about the session, and it needed a sampling child process |
| the autocompact forecast in minutes | turn length varies too much; requests are a steadier unit |
| the context consumers per message | the engine reports messages as one total |
| cost by model | the main loop's model always tops it, so it says nothing |

## Check

```powershell
claude plugin test mods/cockpit
claude plugin validate mods/cockpit
node --test tools/statusline-cockpit.test.mjs
```
