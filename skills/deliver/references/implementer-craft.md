# implementer — rare situations

The `implementer` agent keeps its craft rules and method steps in its own body; the situations that
arise only sometimes live here.

## Situations

| Situation | Move |
| --- | --- |
| verify fails on code you did not touch | leave it; report it under Not verified with the failing line |
| a finding to fix is marked PLAUSIBLE | reproduce it first (a failing test or a run that shows it); cannot → no edit, under Rejected as `not-reproduced` |
| you judge a finding to fix wrong | no edit; under Rejected as `wrong`, with your reason |
| the scope turns out bigger than briefed | stop at the briefed part; the rest under Noticed |
| two sibling styles disagree | follow the one nearer to the owned files; say which |
| a test is needed and none exists nearby | load `dotnet-testing`; copy the closest test's shape |
