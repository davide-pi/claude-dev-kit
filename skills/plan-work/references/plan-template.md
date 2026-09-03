# Plan file template

Copy the skeleton, delete what does not apply, keep the field names. Phases exist only for plans
past ~12 tasks; below that, a flat numbered list is clearer.

The file itself is written in **English**, whatever language the conversation is in: a later session
reads it back as a technical artifact, next to the code. Only the chat around it — the proposal, the
sizing question, the confirmation — is Italian (`plan-work`).

## Skeleton

```markdown
# <Change name>

Branch: `feature/<slug>` · Work item: `<id>` (or `none`) · Source: `docs/specs/<file>.md` (or the
request, quoted in one line)

## Goal

One paragraph, max. What is true after this plan that is not true now — in terms of behaviour, not
of code. If it cannot be stated without listing files, the goal is still a task list.

## Not in scope

Bullets. The things a reader would reasonably assume are included and are not. This section stops
scope creep better than the goal does.

## Open questions

Anything undecided that blocks a task. Each one names the task it blocks and how it will be
answered (probe, doc lookup, ask the user). Empty is a valid answer; `TBD` inside a task is not.

- Q1 — Does the importer need to stay idempotent across retries? Blocks task 4. Answer by reading
  the existing retry policy in `src/Import/ImportHost.cs`.

## Tasks

### 1. <Imperative title>

- files: `src/…/Foo.cs` (edit), `tests/…/FooTests.cs` (new)
- change: <one sentence of observable behaviour>
- interface: `<signature>`  ← only when something else depends on it
- verify: `<command>` → <what the output must show>
- depends on: none

### 2. …

## Verification

The whole-change gate, run after the last task, not instead of the per-task ones. Point at
`done-check` for the change type and list the commands here so a resumed session does not rediscover
them.

## Decisions taken

Appended while executing: the choice, the alternative rejected, the reason, in one line each. This
is the section future-you actually reads.
```

## Worked example (bounded feature, 4 tasks)

```markdown
# Reject orders with no lines

Branch: `feature/order-line-validation` · Work item: `12345` · Source: acceptance criteria on the item

## Goal

Placing an order with an empty line collection fails with a domain error instead of persisting a
zero-total order that later breaks invoicing.

## Not in scope

- Line-level validation (quantity, price) — separate item.
- The frontend error message; the API contract only gains a new error code.

## Open questions

None.

## Tasks

### 1. Add the domain rule

- files: `src/Ordering/Domain/Order.cs` (edit)
- change: `Order.Place` returns a failed result when `Lines` is empty, before any state mutation.
- interface: `Task<Result<OrderId>> Place(PlaceOrder cmd, CancellationToken ct)` — unchanged shape,
  new failure code `order.no_lines`.
- verify: `dotnet build src/Ordering/Ordering.csproj -warnaserror` → 0 errors
- depends on: none

### 2. Cover it with a test

- files: `tests/Ordering.Tests/OrderTests.cs` (edit)
- change: a test asserting `Place` on an order with no lines yields `order.no_lines` and persists
  nothing (repository substitute receives no `Add`).
- verify: `dotnet test tests/Ordering.Tests --filter Place_NoLines_Rejects` → 1 passed, 0 failed
- depends on: 1

### 3. Surface the failure code on the API

- files: `src/Api/Controllers/OrdersController.cs` (edit)
- change: map `order.no_lines` to 422 with the code in the problem-details body.
- interface: response body stays `ProblemDetails`; `extensions.code = "order.no_lines"`.
- verify: `dotnet test tests/Api.IntegrationTests --filter Post_OrderWithoutLines_Returns422`
  → 1 passed
- depends on: 1

### 4. Confirm nothing else regressed

- files: none
- change: full suite of the touched projects.
- verify: `dotnet test Ordering.sln` → Failed: 0
- depends on: 2, 3

## Verification

`done-check`, backend row: build clean with warnings as errors, suite green, the new test named in
the output, `git diff --stat` reviewed.

## Decisions taken

- Failure returned as a result, not an exception — matches the existing handler pipeline, which maps
  results to problem details and would have to grow a catch block otherwise.
```

## Phased form (subsystem)

Group tasks under `## Phase N — <name>` when the plan passes ~12 tasks. Each phase ends at a point
where the system builds and its tests pass, so the work can stop there without leaving a broken
tree. Number tasks continuously across phases (`1`…`17`), so `depends on` never needs a phase
qualifier.

A phase boundary is also the natural place to stop and rerun `done-check`, and the natural cut line
when the plan turns out to be two plans.
