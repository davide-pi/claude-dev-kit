# External sources, read every day

The transcripts see only the time spent with Claude. Meetings, calls, chat threads, mail, manual tests and
reviews leave traces elsewhere. The `worklog-scout` agent reads the sources below **every day of the period**,
under target or not, and returns what it finds as candidate rows of its Table 1 draft. The gap prompt
(`hours-management.md`) is no longer the only path to them.

## Rules

| Rule | Detail |
| --- | --- |
| Proposals, never hours | every event becomes a **candidate row** in Table 1, its source on the `Source` line; the user confirms, edits or drops each one |
| Never auto-logged | a source row without an explicit yes is dropped, not kept "to be safe" |
| No double count | an event overlapping a transcript window already in Table 1 is shown once, merged into that row |
| Read-only | search and read; never send, react, draft, schedule, delete or change anything in a source |
| No bodies | a short topic in the chat language per event; never quote messages or invite text in a table |
| Hours from the window | a calendar event's duration; a chat thread's first-to-last message, rounded by `round.ps1` like any row |
| Mail is a point | a sent or read mail is evidence of what was done at that time: no duration, unless a thread has a first-to-last window |
| Project from the place | channel, meeting organiser, repo or item → project; unknown → `?`, the main session asks, never guess the client |

## Sources (CLI first, then connectors)

| Source | How | Gives |
| --- | --- | --- |
| **Board** | per org of the day: `az boards query --wiql "SELECT [System.Id],[System.Title] FROM workitems WHERE [System.ChangedBy] = @Me AND [System.ChangedDate] >= '<day>' AND [System.ChangedDate] < '<day+1>'"` (verbs: `azdo-cli`); PRs reviewed: `az repos pr list --reviewer <me> --status all` filtered on the day | items groomed, estimated or commented → management or the item's Task |
| **Git** | `git -C <repo> log --since=<day> --until=<day+1> --author=(git config user.email) --format="%h %ad %s" --date=format:%H:%M` on each repo of the day | commits made outside Claude sessions → the branch's topic |
| **Slack** | connector tools found with ToolSearch `+slack search`; the user's id from the profile tool, then a search `from:<@id> on:<day>`, paged until done, huddles and calls included | time windows per channel or DM, huddles and calls with duration |
| **Outlook mail** | connector tools found with ToolSearch `mail`; sent and read mail of the day | points in time: what was answered, sent or handled, per thread |
| **Outlook calendar** | connector tools found with ToolSearch `calendar`; the day's events with start, end, subject, organiser | meetings with duration (replaces the `az rest` calendarView path, which returns 403: no `Calendars.Read`) |
| **Teams chats** | connector tools found with ToolSearch `teams`; the user's chats and meetings of the day | thread windows, calls with duration |

Connector server names are per-account UUIDs: never hardcode one, find the tools by keyword. A source with no
connector in the session: say so in one line (the main session may ask the user to paste the day's agenda); never
block the draft on it.

## Scout brief (what the caller passes)

Period, scope (`sessione`, item, PR, topic), the chat language, the Slack channel or name prefixes the user maps to
clients (ask once per run when unknown; never written into the kit). The scout reports per day, at most 40 lines, no
message bodies.

## In Table 1

Source rows are ordinary Table 1 rows (shape: `tables.md`), the source named on the `Source` line. Then
the usual Table 1 loop: the user keeps, edits or drops each source row; coverage is recomputed.
