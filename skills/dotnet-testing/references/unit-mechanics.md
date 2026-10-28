# Unit test mechanics: xUnit, doubles, assertions, builders

## Conventions

- xUnit creates a new test-class instance per test: constructor = per-test setup. Anything static and
  mutable in a test class is a cross-test channel; do not defeat the per-test instance.
- Async setup or teardown uses the async lifetime interface, not the constructor.
- One test class per class under test, named after it. Test names state behaviour and condition:
  `Rejects_Order_When_Stock_Is_Insufficient`, not `TestPlaceOrder2`.
- Arrange / act / assert separated by blank lines; an arrange block that needs comments belongs in a
  builder. A theory with twelve columns is a table nobody maintains: split it.

## Assertions

Both fluent-assertion styles in use here name actual and expected in failures; prefer them over bare
equality. One assertion per fact; collection assertions rather than loops; object graphs through an
equivalence comparison excluding what the test does not care about; group several facts about one result
so one failure does not hide the others. Do not assert strings the code formats for humans — assert the
data behind them.

## Testing async code

- Every async test returns `Task` and awaits every call: a `void` test that starts async work passes
  unconditionally.
- Assert a throwing async call with the async throw assertion; awaiting first fails the test with the
  exception instead of asserting it.
- Never block inside a test: it hides the deadlock the production code has.
- Pass a real token and cancel it before the call, asserting the cancellation exception: the only way an
  ignored-token bug is caught.
- Background service: start it, wait for an observable effect with a **bounded** wait, stop it. Never a
  fixed delay. Timeouts go on the test attribute, not in a sleep loop.

## Substitutes

- Substitute **interfaces you own** or the framework defines; never make a concrete class's methods
  virtual just to be mockable.
- Arrange only what the path under test reads. Verify an interaction only when it *is* the behaviour
  ("the message was published"); verifying every call copies the implementation and breaks on refactor.
- Never assert on a substitute of the class under test: extract the part you want to stub.
- Match arguments on the values that matter, not a whole object.

## Hand-written fakes, and when one wins

A real implementation backed by a dictionary or list, in the test project; it wins when the dependency
has state or many tests use it: repository (dictionary keyed by id), clock (settable, with advance), id
generator (deterministic sequence), sender (list of what was sent), cache (so the hit path runs), blob
store (name to bytes). It can drift from the real thing, which is why anything relational uses a real
database rather than a fake repository (`untested-legacy.md`).

## Test data builders

One per aggregate, in the test project, with valid defaults and a fluent `With…` per interesting field,
`Build()` and optionally `BuildMany(n)`. Deterministic by default; a data-generation library is
**seeded** and the seed recorded in the failure output, or failures are not reproducible. Overdue when
two tests build the same object with the same irrelevant fields.

## Determinism checklist

Before committing a test, none of these in play: current time or zone, current culture, a random value,
a machine path, an environment variable, a network call, a fixed port, hash-dependent ordering.
