# Cockpit: owner feedback of 2026-10-26

Branch `fix/cockpit-owner-feedback`. Scope: `mods/cockpit/` (hooks, types, tests) and the README's cockpit section.
Gate: `claude plugin test mods/cockpit` and `claude plugin validate mods/cockpit`, run from the repo root.

Open question (not blocking): the owner's misaligned rows weren't in the clipboard (only a 58-cell rule). Task 5
fixes the one asymmetry the code shows; a paste of the rows decides whether more is needed.

## Tasks

- [x] 1. **Per-window credit fallback**
  - files: `mods/cockpit/hooks/view-header.tsx` (edit), `mods/cockpit/tests/cockpit-header-state.test.tsx` (edit)
  - change: each window (`five_hour`, `seven_day`) is drawn from the engine's reading when it has that kind, else from
    `lastRates` with the `~`; an engine reading with only `seven_day` no longer hides the 5h row.
  - interface: `rateRow(s, kind)` unchanged; `isStale` per row.
  - verify: a test with `rateLimits: [seven_day]` and `lastRates: [five_hour, seven_day]` draws `~` 5h and live 7d.
  - depends on: none
- [x] 2. **Estimated rows marked, not exact ones**
  - files: `mods/cockpit/hooks/view-context.tsx`, `mods/cockpit/hooks/strings.ts`, context tests (edit)
  - change: a `used` row that isn't an exact count shows a yellow ` ~` in the 2-cell mark column; exact rows,
    free space and buffer show nothing. The title's legend `✓ = exact` becomes `~ = estimate`.
  - verify: context tests assert `~` on estimated used rows and no `✓`.
  - depends on: none
- [x] 3. **Drop the cost-by-model block**
  - files: `mods/cockpit/hooks/view-tabs.tsx`, `mods/cockpit/hooks/strings.ts`, tests (edit); `costs.ts` removed if unused
  - change: the Context tab no longer draws `BY MODEL`: the main loop's model always tops it, it tells nothing.
  - verify: no `BY MODEL` row in the Context tab test.
  - depends on: none
- [x] 4. **Versioned model and effort in every agent row**
  - files: `mods/cockpit/hooks/view-agents.tsx`, `mods/cockpit/hooks/agents.ts`, `mods/cockpit/types/index.d.ts`, tests
  - change: the model column shows `shortModel` (`son 5.5`, `opus 5.5`, `haiku 5.5`), 9 cells; the history keeps the
    agent's `effort` (optional field, old data files still parse) so its rows draw the effort icon.
  - interface: `CockpitHistoryEntry.effort?: string | number`
  - verify: a history row reads `✓ two  son 5.5 <icon> …`; `parseHistory` of an entry without `effort` still parses.
  - depends on: none
- [x] 5. **TOP AGENTS columns aligned**
  - files: `mods/cockpit/hooks/view-agents.tsx`, tests
  - change: the cost column sits at the same cell in every row: the cache-hit cell is padded to a fixed width,
    blank when unknown, and the dropped-column steps depend on the pane width only, not on the name.
  - verify: rows with and without a cache hit, short and long names, put `$` at the same offset.
  - depends on: 4
- [x] 6. **History: newest 5, the rest behind a toggle**
  - files: `mods/cockpit/hooks/view-tabs.tsx`, `mods/cockpit/hooks/strings.ts`, `cockpit-subagents.test.tsx`, README
  - change: `HISTORY · N` is a plain title, the newest 5 rows always show, a `▸ +N` button opens the rest
    (`isHistoryOpen` now means "all shown").
  - interface: `collapsible(k, key, rows: Block[], shown: number, isOpen: boolean, onToggle: () => void): Block`
  - verify: 7 finished agents → 5 history rows and `▸ +2`; pressed → 7 rows and `▾`.
  - depends on: none
- [x] 7. **Skills consumer labelled**
  - files: `mods/cockpit/hooks/context.ts`, tests
  - change: the consumer `skills` reads `skills 41/52` (listed/total): it's the listing of every skill's description.
  - verify: a context test with `skills: { includedSkills: 41, totalSkills: 52 }` shows `skills 41/52`.
  - depends on: none
- [x] 8. **TOP AGENTS: every agent, 3 shown**
  - files: `mods/cockpit/hooks/view-tabs.tsx`, `register.tsx`, `types/index.d.ts`, tests
  - change: all agents by cost, dearest first, 3 shown, the rest behind the same `collapsible`.
  - interface: `PaneActions.toggleCostAgents(): void`, `CockpitSnapshot.isCostAgentsOpen?: boolean`
  - verify: 5 priced agents → 3 rows and `▸ +2`; pressed → 5.
  - depends on: 6

Finished → the gate, `install.ps1 -Force` then `-Check`, commit on the branch, no push.

## Round 3 (owner, same day)

- [x] 9. **Pane opens at session start by default**
  - files: `mods/cockpit/hooks/register.tsx`, `mods/cockpit/hooks/strings.ts` (cockpit.json parsing), tests, README
  - change: `session.start` opens the pane unless `cockpit.json` says `"autoOpen": false`; missing file or key = open.
    The engine places an unasked pane only from 144 columns, below that it waits undrawn: say so in the README.
  - verify: a session start with no cockpit.json opens the pane; with `autoOpen: false` it doesn't.
- [x] 10. **Folder link in the header**
  - files: `mods/cockpit/hooks/view.tsx` (+ a `file://` URI helper as `statusline.js` `pathToFileUri`), tests
  - change: the folder name in the header grid is a `Link` to the folder (worktree root, else cwd).
  - verify: the header's folder node is a Link with `file:///C:/...` href for a Windows path.
- [x] 11. **Agent rows: share only, tokens in the details**
  - files: `mods/cockpit/hooks/view-agents.tsx`, tests
  - change: the tokens column leaves the row (the share stays); the expanded rows start with the total tokens, live and history.
  - verify: a row reads `✓ name  son 5.5 <icon>  32%  1m00s`; expanded, a `tokens 5.4k` line.
- [x] 12. **Drop `modelUse`**
  - files: `mods/cockpit/hooks/register.tsx`, `session-data.ts`, `types/index.d.ts`, tests
  - change: nothing collects or persists per-model usage any more; an old data file holding it still loads.
  - verify: the gate; a data file with `modelUse` parses.
- [x] 13. **Split the big files** (pure moves, no behaviour change)
  - files: `mods/cockpit/hooks/register.tsx` (642), `tests/cockpit-subagents.test.tsx` (773), `tests/cockpit-header.test.tsx` (616)
  - change: each under 600 lines along a seam that's already there. `workflows/impl-review-loop.js` stays one file:
    a Workflow script must be self-contained (no imports).
  - verify: the gate, same test count.
