# Scoped runs

When `/worklog` names an item, a PR, a topic or a session instead of only a period.

**Scoped**: `/worklog [period] AB#<id> | PR <n> | topic <text>`, or "segna le ore di questo item/PR": only
  the topics whose branch, PR, item or label match go through Phases 3–7; the day's target, COPERTURA, gap
  prompt and close/target rows are skipped (the rest of the day stays for a full run). Nothing matches → say so.
  `sessione <id>` (also "segna le ore di questa chat", id = `${CLAUDE_SESSION_ID}`; unsubstituted →
  ask the user, never take the newest `.jsonl`): Phase 2 runs the engine with `-SessionId <id>` over the
  session's days (the engine finds the first day itself, prints `Sessione <id>: dal <data>`, runs to today unless a period is given); Phases 3–7 keep only the topics
  its **Sessione** section lists, with the session's own minutes there, items from that chat's branch, PRs, commits
  and `AB#` mentions; a topic whose item cannot be told, or flagged `[anche altre sessioni]` (shared
  branch: the topic's whole-day minutes are not the chat's alone), goes to Table 2 as a question (candidates plus "altro"),
  the `[S]` digest lines showing the chat's share, never guessed. The push and the audit stay as they
  are: a row carries the item's day total, so re-runs and other chats stay idempotent.
