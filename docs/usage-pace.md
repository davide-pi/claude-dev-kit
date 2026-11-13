# Usage pace

The account has two limits, a 5-hour and a 7-day window, shared by every chat. The pace feature keeps chats from dying
for lack of credits: it collects both percentages locally (no model tokens), slows a chat by pace as a window
climbs, makes it stop voluntarily before the limit, and resumes the work after the window resets.

## Files

| File | Owner | Role |
| --- | --- | --- |
| `~/.claude/.usage-pace.json` | status line (the cockpit mod only reads it) | shared usage: `{v:1, updatedAt, writer, five_hour:{pct,resetsAt}, seven_day:{pct,resetsAt}, samples5h, samples7d}` |
| `~/.claude/.cache/pace/<sid>.json` | the chat, through `scripts/pace-state.mjs` | `{v:1, sessionId, window, resetsAt, resumeAt, checkpoint, ready}` plus `armedAt` and `compactedAt` (written by the `PreCompact` hook); `--done` deletes the file, and a missing file means nothing to resume |
| `~/.claude/.cache/pace/<sid>.mod.json` | the cockpit mod | `{v:1, compactedAt, aliveAt}`; the mod is alive when `aliveAt` is under 3 minutes old |
| `<git-dir>/deliver/resume-<id8>.md`, else `~/.claude/.cache/resume/<sid>.md` | the chat | the checkpoint: what was done, what runs, what is next; it lives on disk, so no compaction loses it |
| `~/.claude/.cache/pace-notices/` | `hooks/pace.js` | one marker per (session, agent or `main`, window, reset, band), created with flag `wx`; the arm instruction has its own marker |

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
- `paceView` gives per window the band (0, 70, 85, 92, 96, 98; the status line's look, unchanged), the burn in %/h (only
  with 3 or more samples over 5 minutes or more) and the time the window would reach 98% (none when the reset comes
  first). A window past its `resetsAt` reads 0. The hook's own bands (below) are worked out in `hooks/lib/usage-pace.js`.

## The pace rule

A window is *short* when, at the current burn, it runs out before its reset: runway = (100 - pct) / burn hours, shorter
than the time to the reset. An unknown burn is not short. A conditional band below slows the chat only when the window
is short; otherwise it gives the notice line alone, so a chat doesn't slow down early in the week just because 7d usage
is high while the pace still reaches the reset.

A *fast run* is a short window whose runway is under 30 min (5h) or 2 h (7d): it jumps straight to that window's closing
actions (5h 96 plus the arm, 7d 98 plus the arm) without waiting for the band.

## Bands

Every notice carries the burn in %/h and the estimated time of each next band at that rate (none past the reset).

| Band | 5h | 7d |
| --- | --- | --- |
| 70 | notice with burn and the estimated exhaustion | nothing |
| 85 | if short: fewer agents in parallel (same models, quality first); else notice only | notice with burn and the estimated time |
| 92 | if short: no new Workflow, small steps, one subagent at a time, no critical operation (merge, push, migration, deploy, delete), arm the resume (`pace-state.mjs --arm`, then `CronCreate`); else notice only | if short: fewer agents in parallel; else notice only |
| 96 | always: update the checkpoint, `pace-state.mjs --ready`, close the step in hand | if short: no new Workflow, arm the resume (`CronCreate`); else notice only |
| 98 | stop: compact, save state, wait for the cron | always: update the checkpoint, `--ready`, close the step in hand |
| 99 | not used | stop: compact, save state, wait for the cron |

The stop is the 5h window at 98 or the 7d window at 99. Subagents keep a reduced set: the notice bands (5h 70 and 85,
7d 85) and, at the stop, "close your step and report to the parent". A jump over bands sends one notice, the highest
band's; when it is a closing or stop band it carries the arm first, unless the chat's pace file already covers that
window's reset (a file removed by `--done` doesn't). A conditional band told as notice only is told again in full when
the window turns short, only while it is the highest band reached. The brake and closing
notices also say how to disarm when the work ends before the limit.

The brake: in the main loop a new `Workflow` is denied (one `Agent` at a time stays allowed) from 92 on the 5h window
and from 96 on the 7d window when short, and always at the stop band or on a fast run, unless its prompt or args
contain `pace: owner asked` or `pace: finish`. Data older than 10 minutes, or a window past its reset, lifts it. Flows
inside a workflow never pass the hook; they hear the stop notice on their own tool calls.

## Resume

- Always, whether the cockpit mod is alive or not, the chat arms and `CronCreate`s the one-shot at `resumeAt`.
  `pace-state.mjs --arm` picks, among the windows that need arming, the one whose reset is later (a 5h stop with the 7d
  also near its stop resumes at the 7d reset), and prints `resumeAt`, `resumeAtLocal`, `cron`, the checkpoint path and
  `prompt=`, the exact prompt the cron must use. Arming again for another window or reset also says to `CronDelete` the
  previous resume cron; arming again for the same window and reset says to keep the existing cron and create none.
- The resume prompt opens with the words the mod recognises as a resume, then checks the credits: when a window is still
  at or over its stop band the chat arms again and stops; otherwise it reads the checkpoint, verifies the real state
  (git status, the perimeter, the last gate) and continues.
- Open chat with the cockpit mod: the mod no longer submits the resume. Once per arming, on an idle tick or after a main
  turn, once the armed window has reset (`now >= resetsAt`) and before `resumeAt`, it compacts with the checkpoint first
  in the instructions; the cron then resumes the chat. It keeps the heartbeat, so the stop notice says the mod compacts
  at the reset; without a live mod the notice asks the owner to run `/compact`.
- Closed chat: nothing reopens it; the kit creates no Windows scheduled task (the owner's choice). Reopen it with
  `claude --resume <sid>`: the `SessionStart` hook names the checkpoint.
- After `resume` or `compact`, `hooks/pace.js` names the checkpoint and says: verify the real state (git status, the
  perimeter, the last gate) first. `PreCompact` prints the path first, so the summary keeps it.
- When the work is finished, or ends before the limit: `pace-state.mjs --done` and `CronDelete` of the resume cron.
