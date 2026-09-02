# Fan-out patterns

Four shapes that recur. Each gives the split, the per-agent prompt skeleton, and the merge step —
which is the part that decides whether the fan-out paid for itself. All of them assume the output
contract from `delegate-agents` is pasted verbatim into every prompt.

## 1. Closing a test gap

**Shape.** N classes with no tests, one agent per batch of classes. Genuinely independent: each
agent writes new test files only.

**Split.** Group by test project, then by dependency weight — a class with five constructor
dependencies takes as long as three simple ones. 3-5 classes per agent, 4-6 agents.

**Per agent.**

```text
Write tests for: <absolute paths of the 3-5 classes>
Test project: <absolute path> — put new files there, mirroring the source folder structure.
Follow the patterns already in that project: read two existing test files first and match their
framework, mocking style, assertion style and naming. Do not introduce a new library.
Do not touch any file under src/. Do not commit, push, or run any git command.
Cover: the happy path, each guard clause or thrown exception, and each branch with a boundary.
Verify with: dotnet test <test project> --filter FullyQualifiedName~<ClassName>
Report per the contract below. <contract>
```

**Merge.** Run the whole suite yourself once — per-agent filters hide a compile break in a sibling
file. Then check three things across reports: no new package appeared in the project file, no two
agents created the same file name, and the total test count rose by roughly the sum of the reports.
Skim one test file per agent for shape; agents drift toward over-mocking when unsupervised.

## 2. Auditing a pattern across a repo

**Shape.** One question, many areas: "where is user input concatenated into SQL", "which handlers
skip the cancellation token", "which components subscribe without unsubscribing". Read-only, so
parallelism is free and worktrees are unnecessary.

**Split.** By top-level source folder, not by file count — an area's answer needs its whole context.

**Per agent.**

```text
Read-only audit. You never edit, create, commit or post anything.
Area: <absolute path of one folder>
Question: <the single question>
For each hit report: absolute path, line number, the offending line quoted, and whether the input
reaching it is caller-controlled — say "unknown" when you cannot tell from this area alone.
Zero hits is a valid and useful answer. Do not report style opinions.
Report per the contract below. <contract>
```

**Merge.** Dedupe by `path:line`. Sort by whether the input is caller-controlled, not by area. The
"unknown" hits are the real output of the fan-out: they are the ones needing the cross-area view
that no single agent had — resolve them yourself.

## 3. Multi-lens review

**Shape.** One diff, several reviewers with different priors. Already implemented by the
`code-reviewer`, `review-security` and `review-performance` agents; `/pr-review` and `/code-review`
own the orchestration. Do not rebuild it here — this entry exists so the shape is recognisable.

**Split.** By lens, never by file: a security lens over half a diff misses the path that crosses the
other half.

**Merge.** Drop a specialist finding the generalist already reported at the same anchor for the same
defect, keeping the more specific category. Keep both when they describe different failures at the
same line. Re-sort by severity across agents, and track which agent produced each survivor.

## 4. Multi-repo or multi-project sweep

**Shape.** The same question across several repositories or solutions: which ones pin a given
package, which ones still target an old framework, which pipelines lack a step.

**Split.** One agent per repository. Independent by construction — separate working directories.

**Per agent.**

```text
Repository: <absolute path>
Question: <the single question>
Read-only. Do not run any git command that writes, and do not modify any file.
Answer with: the repository name, a yes/no, and the exact evidence — file path plus the line that
proves it. If the repository does not apply (wrong stack, no such project), say so and stop.
Report per the contract below. <contract>
```

**Merge.** Collate into one table, one row per repository, and keep the evidence path in the row —
without it the table cannot be acted on later. Repositories reported as "does not apply" stay in the
table as their own rows; a missing row reads as a missed repository.

## Anti-patterns

| Attempted fan-out | Why it fails | Do instead |
| --- | --- | --- |
| "implement these 5 plan tasks in parallel" | plan tasks carry `depends on` for a reason | fan out only the tasks whose dependencies are all satisfied |
| one agent per layer of the same feature | they must agree on interfaces that do not exist yet | write the interfaces, then fan out the implementations |
| one agent per file of a refactor | a rename crosses every file | one agent, whole refactor, or do it yourself |
| an agent to "review the merged result" | it lacks every report and the conversation | the caller reviews, always |
| an agent per migration in a chain | migrations are ordered by construction | sequential, one at a time, each applied and read back |
| splitting a debug session | the hypothesis under test is shared state | `debug-systematic` in the main thread; delegate only bounded read-only searches |

## Sizing the prompt

A prompt shorter than the output contract is usually under-specified. The five things an agent cannot
infer, and that cost a whole round trip when omitted:

1. Absolute paths — of what it owns, and of what it must not touch.
2. The conventions to follow, or the skill name that carries them.
3. The verify command, and what its output must show.
4. The forbidden operations: no commit, no push, no migration applied, no deploy.
5. That "zero findings" or "not verified" are acceptable answers — otherwise an agent invents
   something to fill the report.
