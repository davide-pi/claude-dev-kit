# The engine's time model

Open when the hours or spans look wrong. Output and usage: `tempo-e-topic.md`.

| Kind | Rule |
| --- | --- |
| `CLAUDE` | per session, the union of its turns (`turn_duration`) and its subagents' activity (events ≤ 15 min apart, `-IdleMinutes`, or a longer gap spanned by one tool call of that subagent, up to `-MaxSpanMinutes`); a turn with no `turn_duration` (interrupted) runs from its prompt to the last reply before the next prompt; **summed** across sessions; background jobs (dev servers) never count |
| `TU` | after each busy interval of a session, up to 15 min (`-MarginMinutes`) or until that session's next busy start or prompt; **counted once**: the union over all sessions, minus every session's busy time, each minute to the topic of the session whose busy interval ended last |

A resumed transcript copies earlier messages: those
count once, and a resume joins the original session (a fork running in parallel stays a separate
one). Who the original is: the file that starts first; on a tie, the chain created first (a chain follows
the `continued-in` lines; a file in no chain is its own chain), then the original before its resume inside
the chain, then the file created first. Limit: only some resumes leave a `continued-in` line (none for a
plain `--resume` or a fork), and the creation time is unreliable after a copy, sync or restore, so the head
of a fork can land on the wrong file.

Example: chat 1 works 10:00-11:00, chat 2 works 10:30-11:30, the user reads 15 min after each →
`CLAUDE` 2h (summed), `TU` 15m (only 11:30-11:45: 11:00-11:15 is covered by chat 2 working),
`TOTALE` 2h15m.
