# External sources for an under-target day

The transcripts see only the time spent with Claude. Meetings, calls, chat threads, manual tests and
reviews leave traces elsewhere. This file is opened **only** when the gap prompt's answer is
`Cercale nelle fonti` (`hours-management.md`): on an under-target day, each time, never by default.

## Rules

| Rule | Detail |
| --- | --- |
| Proposals, never hours | every event becomes a **candidate row** in Table 1, its source on the `Source` line below the table; the user confirms, edits or drops each one |
| Never auto-logged | a source row without an explicit yes is dropped, not kept "to be safe" |
| No double count | an event overlapping a transcript window already in Table 1 is shown once, merged into that row |
| Read-only | search and read; never send, react, draft, schedule or change anything in a source |
| No bodies | a short topic in the chat language per event; never quote messages or invite text in a table |
| Hours from the window | a calendar event's duration; a chat thread's first-to-last message, rounded by `round.ps1` like any row |
| Project from the place | channel, meeting organiser, repo or item → project; unknown → ask, never guess the client |

## Sources, in order (CLI first)

| Source | How | Gives | Status |
| --- | --- | --- | --- |
| **Board** | per org of the day: `az boards query --wiql "SELECT [System.Id],[System.Title] FROM workitems WHERE [System.ChangedBy] = @Me AND [System.ChangedDate] >= '<day>' AND [System.ChangedDate] < '<day+1>'"` (verbs: `azdo-cli`); PRs reviewed: `az repos pr list --reviewer <me> --status all` filtered on the day | items groomed, estimated or commented → management or the item's Task | CLI, read-only |
| **Git** | `git -C <repo> log --since=<day> --until=<day+1> --author=(git config user.email) --format="%h %ad %s" --date=format:%H:%M` on each repo of the day | commits made outside Claude sessions → the branch's topic | local |
| **Slack** | a **subagent** (the main context never holds the search noise) with the brief below; tools `mcp__plugin_slack_slack__*`, found with ToolSearch `+slack search` | time windows per channel or DM, huddles and calls with duration | used by the owner on a real reconstruction; requires the Slack plugin |
| **Outlook / Teams calendar** | Graph `GET /me/calendarView?startDateTime=<day>T00:00&endDateTime=<day+1>T00:00` with `Prefer: outlook.timezone="<IANA timezone>"` | meetings with start, end, subject, organiser | `az rest` returns **403 ErrorAccessDenied**: the Azure CLI app has no `Calendars.Read`. Use an M365 / Outlook connector if the session has one (ToolSearch `calendar`); else ask the user to paste the day's agenda |

Stop at the first sources that cover the gap; say which were not available and why, in one line.

## Slack subagent brief

```text
Read-only task. Never send, draft, react, schedule or modify anything.
Goal: the user's Slack activity on <yyyy-MM-dd> (local time), to cover hours not seen elsewhere.
Load the tools with ToolSearch "+slack search". Find the user's id with slack_read_user_profile, then
slack_search_public_and_private with `from:<@id> on:<yyyy-MM-dd>`; page until done; include huddle
and call messages.
Report in the chat language, max 15 lines: one table | Fascia | Canale/DM | Argomento (max 8 parole) | Progetto |
— windows merged when messages are < 15 min apart; mark messages sent through the Claude integration;
huddles/calls with their duration if visible. No message bodies, no preamble.
```

Project hints for the brief: the channel prefixes or names the user maps to clients (ask once per run
when unknown; never written into the kit).

## In Table 1

Source rows are ordinary Table 1 rows (shape: `tables.md`), the source named on the `Source` line. Then
the usual Table 1 loop: the user keeps, edits or drops each source row; coverage is recomputed.
