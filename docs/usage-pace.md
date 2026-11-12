# Usage pace

The account has two limits, a 5-hour and a 7-day window, shared by every chat. The pace feature keeps work from stopping
in the middle of a step: it collects both percentages locally (no model tokens), tells the chats as they climb, holds new
flows back near the limit, and resumes the work after the reset.

## Files

| File | Owner | Role |
| --- | --- | --- |
| `~/.claude/.usage-pace.json` | status line (and the cockpit mod) | shared usage: `{v:1, updatedAt, writer, five_hour:{pct,resetsAt}, seven_day:{pct,resetsAt}, samples5h, samples7d}` |
| `~/.claude/.cache/pace/<sid>.json` | the chat, through `scripts/pace-state.mjs` | `{v:1, sessionId, window, resetsAt, resumeAt, checkpoint, ready}` plus `armedAt` and `compactedAt` (written by the `PreCompact` hook); `--done` deletes the file, and a missing file means nothing to resume |
| `~/.claude/.cache/pace/<sid>.mod.json` | the cockpit mod | `{v:1, compactedAt, resumedAt, aliveAt}`; the mod is alive when `aliveAt` is under 3 minutes old |
| `<git-dir>/deliver/resume-<id8>.md`, else `~/.claude/.cache/resume/<sid>.md` | the chat | the checkpoint: what was done, what runs, what is next; it lives on disk, so no compaction loses it |
| `~/.claude/.cache/pace-notices/` | `hooks/pace.js` | one marker per (session, agent or `main`, window, reset, band), created with flag `wx` |

Pace files and checkpoints under `.cache/resume/` are pruned after 7 days; so are the notice markers.

## Shared file

`statusline.js` calls `recordPace` before its cockpit early return, so the file is written with the pane open too.

- `resets_at` (seconds) is stored in ms. Each sample list is emptied on its own window's reset; a sample is kept every
  60 s or more, the last 60 only.
- A reading is accepted with a newer `resetsAt`, or with the same `resetsAt` and a percentage not lower. Unknown fields
  (the cockpit's) are kept.
- The write is atomic (temp file per pid, then rename), and skipped when nothing changed and the last write is under
  60 s old. A torn file reads as the last good value, or null; readers never throw. A torn file met by `recordPace`
  (the cockpit writes in place) skips that render rather than rewrite the file from scratch.
- `paceView` gives per window the band (0, 70, 85, 92, 96, 98), the burn in %/h (only with 3 or more samples over 5
  minutes or more) and the time the window would reach 98% (none when the reset comes first). A window past its
  `resetsAt` reads 0.

## Bands (both windows, the weekly one is not spread over days)

| Band | What the chat does |
| --- | --- |
| 70 | notice only: projection and reset time |
| 85 | fewer parallel agents, smaller models where they are enough |
| 92 | `pace-state.mjs --arm` (prints `resumeAt`, `resumeAtLocal`, `cron` and the checkpoint path), create the resume task (`resume-task.ps1`), start no new flow, ask running flows for their state and write the checkpoint |
| 96 | verify the resume task exists (create it when missing), update the checkpoint, `pace-state.mjs --ready`; with no live mod `CronCreate` a one-shot at `resumeAt`, with one `CronDelete` any it has (decided here, not at 92: the mod beats every 30 s only once the pace file exists, so right after `--arm` it can look dead); the mod compacts after the turn, else the chat asks the owner to run `/compact` |
| 98 | close the step in hand, stop the flows cleanly, last checkpoint update, stop; a subagent closes its step and reports its state |

Notices at 92 and 96 go to the main loop only; subagents hear 70, 85 and 98. A jump over bands sends one notice, the
highest band's, which carries first the actions of a skipped 92 (arm the resume) and 96 (check the task, `--ready`,
compaction). The 92 and 96 notices also say how to disarm when the work ends before the limit. The brake: in the main
loop, from 92% on either window, a new `Agent`, `Task` or `Workflow` is denied unless its prompt or args contain
`pace: owner asked` or `pace: finish`. Data older than 10 minutes, or a window past its reset, lifts it. Flows inside a
workflow never pass the hook; they hear the 98 notice on their own tool calls.

## Resume

- Open chat with the cockpit mod: the mod compacts once on `ready`, then resumes at `resumeAt` (window under 50%, the
  other under 98%; else 10 minutes later).
- Open chat without the mod: `CronCreate` at `resumeAt`, made at 96.
- Closed chat: the Windows task `claude-resume-<id8>` runs `resume-launch.ps1`, which deletes its own task first, opens
  nothing when the chat lives (a `sessions/<pid>.json` with the session id, a live pid and a matching process start) or
  the mod is alive. When the chat was not compacted since it was armed (no `compactedAt` at or after `armedAt`, in the
  pace file or the mod file) it runs `claude -p --resume <sid> /compact` first (up to 15 minutes, best effort), then
  starts a new Windows Terminal window with `claude --resume <sid>` and the resume prompt, and exits.
- After `resume` or `compact`, `hooks/pace.js` names the checkpoint and says: verify the real state (git status, the
  perimeter, the last gate) first. `PreCompact` prints the path first, so the summary keeps it.
- When the work is finished, or ends before the limit: `pace-state.mjs --done`, `resume-task.ps1 -Remove`, and
  `CronDelete` of the resume prompt when one was created.

## Windows tasks

Root folder, one `Register-ScheduledTask` call, once trigger at `resumeAt`, `EndBoundary` = `resumeAt` + 6 h,
`DeleteExpiredTaskAfter` 0, `StartWhenAvailable`, allowed on battery. A `resumeAt` more than 6 hours past is refused
(arm again). Creating a task first sweeps the `claude-resume-*` tasks past their `EndBoundary` or whose pace file is
gone or done (`-Sweep` does the same alone); then the cap is 5: at 5 live `claude-resume-*` tasks a new one is refused
with a message, and no other chat's live task is removed. The count and the registration hold the named mutex
`Local\claude-resume-task`, so chats crossing 92% together cannot overshoot the cap. The tests use `-DryRun` (or
`-TasksJson`, which implies it) and set `CLAUDE_PACE_NO_SCHEDULER`, which makes both scripts stop before any scheduler
call: they never register or remove a task.
