# Kit v3 — communication audit (Claude ↔ owner)

Source: 176 top-level sessions (last 30 days, subagents excluded), 1 654 owner turns, 1 581 assistant finals; `python -I`.

## 1. Findings
### 1.1 Assistant final messages

| Metric | Value |
|---|---|
| Length (chars) | median 1 639 · p75 2 643 · p90 3 633 · max 23 846 |
| Buckets <300 / 300–1k / 1–2.5k / 2.5–5k / >5k | 121 / 324 / 697 / 399 / 40 |
| Contains a table | 71 % (296 long finals have a table >10 rows) |
| Bold summary first line | 47 % overall · 56 % of long (>2.5k) |
| `> **Dettaglio**` block · headers · `Proposta` table | 11 % · 17 % (44 % of long) · 235 finals |
| Emoji in long finals | 72 / 637 (rule says none) |
| Mid-turn narration before the final | 933 turns, median 451 chars each |

**The scroll problem is the main one.** Of 637 finals >2 000 chars, 400 end on a question or a decision to take; only
60 announce that decision in the first line. First line: median 199 chars, p90 309, 74 over 300 — the "one bold
sentence" has become a paragraph.

### 1.2 Owner reactions (share of 1 478 turns that had a follow-up)

| Reaction (proxy) | n | % | Note |
|---|---|---|---|
| Challenges a conclusion ("sicuro?", "davvero?", "ricontrolla", "agnostico") | 113 | 7.6 | Not proven wrong claims; owner distrusts unverified reasoning |
| Corrects a misread intent ("no, intendevo…", "non era…") | 81 | 5.5 | Mostly multi-ask prompts answered partially |
| Asks for an explanation ("mi spieghi", "come mai") | 55 | 3.7 | Jargon or a conclusion given without the mechanism |
| Scope creep ("modifiche minime", "basta con le modifiche") | 32 | 2.2 | |
| Cost/model ("sonnet", "crediti") | 34 | 2.3 | Agents launched on Opus by default |
| Didn't understand ("non ho capito", "cosa intendi") | 25 | 1.7 | Often one item of a numbered list |
| Acted when asked only to answer ("non fare modifiche, rispondi e basta") | 17 | 1.2 | |
| Asked when he wanted action ("fai tu", "come meglio credi") | 17 | 1.2 | |
| Shorten / too long | 15 | 1.0 | |
| Language (Italian/English mix) | 7 | 0.5 | Mostly about code naming, not chat |
| Request interrupted mid-turn | 48 | — | Claude kept going after the answer was clear |

Quotes (anonymized):
- "allora il #3 dovremmo sistemarlo. Il #2 non ho capito ma è un problema… #1 serve un retry? #4 non credo serva…"
- "siamo sicuri che non dia regressioni…? non fare modifiche rispondi e basta"
- "non serviva la run manuale!"
- "fai tu, sui file nuovi procedi come meglio credi! sui file preesistenti o su modifiche pericolose me ne parli alla fine"
- "mi raccomando con agent sonnet o finiamo i crediti tra poco!"

### 1.3 Questions Claude asked

| Metric | Value |
|---|---|
| `AskUserQuestion` calls / questions | 85 calls · 118 questions · 101 with a Recommended option |
| Answered via the tool | 92: Recommended 50 · other option 22 · free text 9 · cancelled 11 |
| "Which work item do I link to the PR?" | 33 / 118 (28 %) — always the same answer: create a Bug/US |
| Plain-text finals ending with `?` / of which permission asks ("procedo?") | 519 (158 answered bare "ok") / 240 (74 "yes") |

Unnecessary: the work-item question (a policy, not a choice); permission asks on reversible steps. Useful: asks
carrying a fact he lacked (migration drift, agents on Opus).

### 1.4 How the owner writes

| Metric | Value |
|---|---|
| Turn length | median 99 chars · p90 421 · 75 turns >800 (pasted client text, logs) |
| Lowercase start | 1 555 / 1 654 (94 %) |
| Several asks in one turn ("inoltre", "poi", "PS:", numbered, ≥2 `?`) | 540 / 1 654 (33 %) |
| Refers to findings by number (`#3`, "punto 2") | 79 turns |
| Bare acknowledgements ("ok", "vai") | 20 — he almost always adds the next ask |

Typos are transpositions ("oredatto", "sisteamto", "regresiioni"): fast typing, not dictation. Tails ("no?", "vero?!")
are confirmations, not open questions. Constraints come late in the sentence ("…ma senza push", "…con agent sonnet").
Parsing implications: a turn is a checklist (each `?`/"inoltre"/"poi" is an item, answered in order); a trailing
"no?/vero?" wants sì/no plus one line of evidence; constraints anywhere bind the whole turn; a fuzzy token is a known
identifier misspelled (resolve against the codebase, don't ask); `#n` refers to the last report, so numbering is stable.

### 1.5 Instructions vs behaviour

`Concise` is built in; its text ends with "where these rules conflict with … guidance elsewhere, these rules win" and
prefers "1–3 sentences of plain prose" with tables "only when they carry real structure". It knows nothing of Italian,
decision-first, `> **Dettaglio**`, stable `#n` or emoji. CLAUDE.md "Write for me" (273 B) does not say where the
decision goes, how to answer a multi-ask turn, or when a table is wrong (2-column key/value lists).

## 2. Proposals

### 2.1 Replacement for CLAUDE.md "Write for me" (current 273 B → 538 B, +265 B)

```
## Write for me
80/20: reading time is my bottleneck. Decision first, evidence after.
- Line 1, bold, ≤140 chars: the result, and the one thing I must decide or confirm (if any).
- Then the shortest shape that fits: 1–3 sentences; or a table when ≥3 rows × ≥2 real columns; or
  numbered items. Depth only in `> **Dettaglio**` or a reference loaded on demand. No emoji.
- Several asks in one message → answer each, in order, numbered; keep my `#n` numbers stable.
- A yes/no question gets yes or no, then one line of evidence.
```

### 2.2 Output style: yes, a custom one beats `Concise`
The built-in overrides CLAUDE.md on conflict, favours prose, and carries none of the owner's rules. A custom style can
hold the whole *shape* contract (CLAUDE.md can later shrink to "style `owner-80-20` applies") and lives per-user,
outside the kit's byte budget. Draft for `~/.claude/output-styles/owner-80-20.md` (then `"outputStyle": "owner-80-20"`;
`keep-coding-instructions` verified in the 2.1.304 binary):

```markdown
---
name: owner-80-20
description: Decision-first Italian answers for a senior dev who reads fast; tables when they carry rows, no narration
keep-coding-instructions: true
---
# Style: 80/20, decision first
The reader is a senior developer; reading time is the bottleneck. Write in Italian; code, identifiers,
commands, tool output, `file:line`, `CONFIRMED`/`PLAUSIBLE`, `P1|P2|P3`, `S|M|L` stay verbatim.

1. **First line, bold, ≤140 chars**: the result plus the one decision or confirmation needed, if any.
   Never a paragraph. If nothing is needed from the reader, say "nessuna azione".
2. **Then the shortest shape that fits**: 1–3 sentences for a simple answer; a table only with ≥3 rows
   and ≥2 real columns (a 2-column key/value list is bullets); numbered items for findings and steps.
3. **Depth goes below** a `> **Dettaglio**` block, or into a file the reader can open. Mechanism before data:
   when a conclusion is not obvious, one line on *why* precedes the numbers.
4. **Multi-ask turns**: the message is a checklist. Answer every item, in its order, numbered; a trailing
   "no?/vero?/giusto?" gets **sì/no** and one line of evidence. Constraints stated anywhere in the turn
   ("senza push", "non committare", "agent sonnet") bind the whole turn.
5. **Stable numbering**: findings and proposals keep their `#n` for the whole dialogue; a fixed item
   becomes one line, never renumbered.
6. **No narration between tools**: no "Now I'll…", no progress prose, no closing recap. Work, then report.
7. **Ask only before the irreversible** (data, deploy, delete, push to a shared branch, money). A
   reversible choice: state the default in one line and proceed. A policy with a fixed answer is not a
   question. Use `AskUserQuestion` only when the choice carries a fact the reader lacks; otherwise ask
   in plain text, one question, at the end of the first line.
8. **No emoji, no hedging, no restating the request.** Errors, failing tests, security warnings and
   destructive-action confirmations keep full content.
Where these rules conflict with general formatting guidance elsewhere, these rules win.
```

Trade-off: it replaces `Concise` (not additive); rule 8 re-imports its only safeguard. Re-run the audit script after a
week: targets first-line median ≤140 chars, decision in line 1 ≥80 % of long finals, mid-turn narration ≤200 chars.

### 2.3 ALM rule adjustment (needs the owner's ok; changes `pr-create`)
"No linkable backlog item → create a Bug (defect) or User Story (feature), assigned to me, link it, say so in one
line." Removes 28 % of all `AskUserQuestion` calls; keep the ask only when an existing open item is plausible.

### 2.4 Habits for the owner (prompting)

| # | Habit | Why |
|---|---|---|
| 1 | Put the mode word first: `analisi` / `rispondi` / `fai` / `fai e PR` | 17 "acted when asked to answer" + 17 "asked when he wanted action"; the verb at the start disambiguates before Claude plans |
| 2 | Constraints in the first line, not the tail: "senza push, sonnet, modifiche minime" | Late constraints were missed in 32 scope-creep and 34 model/cost corrections |
| 3 | Number your asks when there are ≥2 ("1. … 2. … 3. …") | 33 % of turns are multi-ask; numbering makes partial answers visible and `#n` replies cheap |
| 4 | Reply to findings with `#n ok / #n no / #n spiega` and nothing else | Already his best pattern (79 turns); it is the cheapest round-trip for both sides |
| 5 | Pass "default: X" with a choice ("item: crea Bug se manca") | Turns a question into a one-line notice; the cost of a wrong default is a reversible edit |

## 3. Caveats
Reading time is not in the transcripts (length and position are proxies); "challenges a conclusion" counts doubt, not
confirmed errors; compaction-summary turns are excluded from quotes, not from counts (<1 %); no style A/B yet (2.2).
