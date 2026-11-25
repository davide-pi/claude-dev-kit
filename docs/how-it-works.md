# How the kit works

Four penguins take a request from analysis to a tested change. The pictures below show who hands what to whom.

## 1. The penguins

| Penguin | Does | Never does | Call it |
| --- | --- | --- | --- |
| `kowalski` | Analysis and plan. Reads the code, asks one round of questions, drafts atomic tasks. | Edits code. Starts building without the owner's ok. | `/kowalski analizza [request]` |
| `skipper` | Coordination. Runs a request or an approved plan through `deliver` and reports the outcome. | Decides what `deliver` decides. Commits or pushes. | `/skipper implementa [request]` |
| `rico` | Bugs. Reproduces, proves the root cause, fixes with a repro test. | Fixes before the cause is proven. Ships a guessed fix. | `/rico sistema [bug]` |
| `soldato` | Tests. Runs the unit and integration tests of the change, then offers real tests. | Fixes a red test. Runs live or e2e tests unasked. | `/soldato testa [what]` |

The request can also come from the conversation. Then you type only the name.

## 2. Workflows

### a. Entry points and handoffs

```mermaid
flowchart LR
  U(["You"])
  K["kowalski"]
  S["skipper"]
  R["rico"]
  T["soldato"]
  D["skill deliver"]
  B["workflow build"]
  U -->|"analysis"| K
  U -->|"a change"| S
  U -->|"a bug"| R
  U -->|"tests"| T
  K -->|"owner ok on the plan"| S
  R -->|"the fix"| S
  S -->|"M or L request, no approved plan"| K
  S -->|"test red, cause unknown"| R
  T -->|"red test, cause unknown"| R
  T -->|"red test, cause known"| S
  S -->|"runs the change"| D
  D -->|"size M or L"| B
  K -.->|"wrong entry, one line"| S
  R -.->|"wrong entry, one line"| K
  T -.->|"wrong entry, one line"| S
```

Any penguin that gets a wrong-entry request names the right owner in one line and hands it over.

### b. kowalski

```mermaid
flowchart TD
  A["Restate the request in one line"] --> B["Fan out the reads<br/>investigator or Explore"]
  B --> C["Draft atomic tasks with plan-work"]
  C --> D{"Size M or L?"}
  D -->|"yes"| E["One Plan subagent challenges the draft"]
  D -->|"no, size S"| F["One question round"]
  E -->|"accepted points folded in"| F
  F -->|"answers"| G["Show the final plan"]
  G --> H{"Owner ok?"}
  H -->|"yes"| I(["Hand the plan to skipper"])
  H -->|"no"| J["Revise the plan"]
  J --> G
```

One challenger and one question round. There is never a debate loop.

### c. deliver by size

```mermaid
flowchart TD
  A["Triage: scenario, size, risk, test matrix"] --> B["One question round up front"]
  B --> C{"Size"}
  C -->|"S"| S1["Edit inline or with one implementer"]
  S1 --> S2["One code-reviewer"]
  S2 -->|"P1 and P2 findings"| S3["Fix only those"]
  S3 --> Z["Run the test matrix"]
  C -->|"M or L"| M1{"Approved plan?"}
  M1 -->|"no"| M2["plan-work, then one Plan challenger"]
  M2 -->|"draft"| M3["Owner's ok"]
  M1 -->|"yes"| M4["Launch workflow build"]
  M3 -->|"ok"| M4
  M4 -->|"summary"| Z
  C -->|"docs only"| D1["Edit inline"]
  D1 --> D2["One code-reviewer"]
  D2 -->|"P1 and P2 findings"| D3["Fix only those"]
  D3 --> D4["Run the doc check"]
  Z --> V(["Verdict"])
  D4 --> V
```

Every size ends in a verdict. M and L launch `build` and read only its summary.

### d. The `build` workflow

```mermaid
flowchart TD
  A["Baseline: testCmd must be green"] -->|"red or no test"| X(["stop"])
  A -->|"green"| W["Next wave of tasks"]
  W --> T["Tests-only implementer"]
  T -->|"red check"| I["Implementers<br/>parallel if files are disjoint"]
  I --> G["gate-runner runs each verify, one at a time"]
  G -->|"red"| RT["One retry by the implementer"]
  RT -->|"verify again"| G
  G -->|"green"| N{"More waves?"}
  N -->|"yes"| W
  N -->|"no"| SU["gate-runner runs the suite"]
  SU --> RV["Fresh code-reviewer<br/>plus an opus reviewer on sensitive axes"]
  RV --> F{"P1 or P2 findings in the change?"}
  F -->|"yes, rounds left"| FX["One fixer per file"]
  FX -->|"suite again"| RV
  F -->|"no, or 3 rounds done"| O(["Summary: status, stops, open findings"])
```

Findings outside the change go to the summary and are never fixed.

### e. rico

```mermaid
flowchart TD
  A{"Is it a bug?"} -->|"no"| H(["Name the owner, hand over"])
  A -->|"yes"| B["Reproduce with debug-systematic"]
  B --> C{"Repro found?"}
  C -->|"no"| X(["Report what was tried and stop"])
  C -->|"yes"| D["Prove the root cause"]
  D -->|"repro becomes a failing test"| E["Hand cause and test to skipper"]
  E -->|"deliver, scenario bug"| F["Fix"]
  F -->|"repro test"| G(["Report the test going green"])
```

The repro test is the proof. A guessed fix never ships.

### f. soldato

```mermaid
flowchart TD
  A{"A test request?"} -->|"no"| H(["Name the owner, hand over"])
  A -->|"yes"| B["Run the unit and integration tests the change touches"]
  B --> C{"Any red test?"}
  C -->|"yes, cause unknown"| R(["Hand to rico"])
  C -->|"yes, cause known"| S(["Hand to skipper"])
  C -->|"no"| Q["One question: run the real tests?"]
  Q -->|"yes"| L["Run them with skill run"]
  Q -->|"no or silence"| P["Skip them"]
  L --> Y(["Report each command and what did not run"])
  P --> Y
```

Real tests hit live systems. They run only after a yes.

## 3. Who uses whom

A cell shows the model tier when a source states one. An empty cell means the column does not use the agent.

| Agent | kowalski | skipper / deliver S | deliver M/L | docs-only | build workflow | rico | soldato | review-pair |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Explore` | haiku | | | | | | | haiku |
| `investigator` | sonnet | | | | | | | |
| `Plan` | opus, or sonnet with no risk axis | | opus, or sonnet with no risk axis | | | | | |
| `implementer` | | sonnet | | | haiku, sonnet or opus | | | |
| `code-reviewer` | | sonnet | | haiku | sonnet or opus, plus opus on sensitive axes | | | sonnet and opus |
| `gate-runner` | | | | | haiku | | | |
| `db-analyst` | | | | | | | | |
| `ops-analyst` | | | | | | | | |
| `review-performance` | | | | | | | | |
| `review-security` | | | | | | | | |

The M/L column shows the challenger only. Its implementers and reviewers run inside `build`.

```mermaid
flowchart LR
  K["kowalski"] --> EX["Explore"]
  K --> IN["investigator"]
  K --> PL["Plan"]
  D["deliver"] --> PL
  D --> IM["implementer"]
  D --> CR["code-reviewer"]
  D --> BU["workflow build"]
  BU --> IM
  BU --> CR
  BU --> GR["gate-runner"]
  RP["workflow review-pair"] --> EX
  RP --> CR
  CV["skill code-review"] --> CR
  CV -->|"high effort, or a focus"| RS["review-security"]
  CV -->|"high effort, or a focus"| RPF["review-performance"]
  DB["skill db"] --> DA["db-analyst"]
  LG["skill logs"] --> OA["ops-analyst"]
```

Four agents have an empty row in the table. Other skills call them: `code-review` calls the two specialist reviewers, `db` runs in `db-analyst`, `logs` runs in `ops-analyst`.
