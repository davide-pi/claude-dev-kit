# Finding format — order, field values, the closing verdict line

Shared by `code-reviewer`, `review-security` and `review-performance`. The Finding block and the
one-defect-per-block rule stay inlined in each agent (the validator checks them against
`report-format.md` § Finding block); order, `risk` and `effort` values: `report-format.md` § Fields.

## Closing verdict line

`Verdict: N findings (X todo, Y done · P1: N · CONFIRMED: N, PLAUSIBLE: N)`, written in the chat
language (the `Lang:` line), never a fixed one. A specialist names its pass (`N security findings`);
`code-reviewer` appends ` · security: N · completeness: N`. At chat `it`: Verdict=Verdetto,
findings=rilievi, Intent=Intento, points=punti, covered=coperti.

Each agent adds only its own closing fields (intent coverage, surface summary, hot-path summary).
