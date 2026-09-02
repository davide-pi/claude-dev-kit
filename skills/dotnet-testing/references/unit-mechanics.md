# Unit test mechanics: xUnit, doubles, assertions, builders

## Structure and lifecycle

| Need | Mechanism |
|---|---|
| Per-test setup | the test class constructor — a new instance is created for **every** test |
| Per-test teardown | implement the disposable interface on the test class |
| Setup shared by the tests in one class | a class fixture, constructed once for the class |
| Setup shared across several test classes | a collection fixture plus a collection definition |
| Async setup or teardown | the framework's async lifetime interface, not the constructor |

The per-test instance is the feature that keeps xUnit tests independent — do not defeat it with
static fields. Anything static and mutable in a test class is a cross-test channel.

One test class per class under test, named after it. One nested class or one region per method under
test when the class is large. Test names state the behaviour and the condition, not the method name:
`Rejects_Order_When_Stock_Is_Insufficient` reads as a specification; `TestPlaceOrder2` does not.

Arrange, act, assert — with a blank line between the three. When the arrange block needs comments to
be understood, it belongs in a builder.

## Data-driven tests

| Shape | Use |
|---|---|
| A handful of inline scalar cases | the inline-data attribute, one line per case |
| Cases that need objects, or are shared between tests | a member-data property or a class-data source |
| The same suite of assertions over many implementations | a generic base test class the implementations inherit |

Keep the case list readable: if you cannot tell from the attribute line what the case is about, add
a description parameter that only exists to name it. A theory with twelve columns is a table nobody
maintains — split it.

## Assertions

Both fluent-assertion styles in use here read as sentences and, more importantly, produce failure
messages that name the actual and expected values. Prefer them over bare equality asserts, whose
failure output tells you nothing about a collection or an object graph.

| Assert | Style |
|---|---|
| A value | one fluent assertion per fact the test is about |
| A collection | a collection assertion (equivalence, contains, has count) — never loop and assert |
| An object graph | an equivalence comparison, excluding the members the test does not care about |
| An exception | assert the invocation throws, and assert the message or a property, not the exact text |
| Several facts about one result | group them so one failure does not hide the others |

Do not assert on strings the code formats for humans — they change. Assert on the data behind them.

## Testing async code

- Every async test returns `Task` and awaits every call. A test returning `void` that starts async
  work passes unconditionally.
- Assert on a throwing async call with the async form of the throw assertion; awaiting first and then
  asserting will fail the test with the exception instead of asserting it.
- Never block inside a test. It hides the deadlock the production code has.
- Pass a real cancellation token and assert cancellation actually happens: cancel the source before
  the call, assert the cancellation exception. This is the only way the ignored-token bug is caught.
- For a background service, call its start method, wait for an observable effect with a **bounded**
  wait, then stop it. Never wait on a fixed delay: it is either flaky or slow, usually both.
- Timeouts belong on the test attribute, not in a loop with a sleep.

## Substitutes (a mocking library)

Both substitute-style libraries in use here follow the same shape: create a substitute for an
interface, arrange the calls the test needs, act, then verify only the interactions the test is
about.

Rules that keep them useful:

- Substitute **interfaces you own**, or interfaces the framework defines. Never a concrete class with
  virtual methods added just to be mockable — that is a design change to serve the test.
- Arrange only what the path under test reads. A block of setups for calls that never happen is dead
  weight that breaks on refactor.
- Verify an interaction only when the interaction *is* the behaviour ("the message was published").
  Verifying every call turns the test into a copy of the implementation, and every refactor breaks it.
- Never assert on a substitute of the class under test. If you feel the need, extract the part you
  want to stub into a real dependency.
- Argument matchers: match on the values that matter, not on a whole object, or the test fails when an
  unrelated field is added.

## Hand-written fakes, and when one wins

A fake is a real implementation of the interface, backed by a dictionary or a list, living in the test
project. It wins when the dependency has state or is used by many tests:

| Interface | Fake |
|---|---|
| A repository or query surface | a dictionary keyed by id, with add, get, and a filter |
| A clock | a settable current time, plus an advance method |
| An id generator | a deterministic sequence |
| An email or message sender | a list of what was sent, asserted directly |
| A cache | a dictionary, so a cache-hit path is actually exercised |
| A file or blob store | a dictionary of name to bytes |

The payoff: tests read as "given these two orders exist" instead of six setups; a new test costs one
line; the fake's own behaviour can be verified once with a small suite of its own. The cost: it can
drift from the real implementation, which is exactly why anything relational should use a real
database rather than a fake repository (see `real-database.md`).

## Test data builders

A builder gives an object valid defaults and lets a test override only the field it is about:

- one builder per aggregate, in the test project, with a fluent `With…` per interesting field;
- valid defaults, so an unrelated required field never appears in a test;
- a `Build()` that returns the object, and optionally a `BuildMany(n)`;
- deterministic values by default. If a data-generation library is used, **seed it** and record the
  seed in the failure output, or a failure will not be reproducible.

The signal that a builder is overdue: two or more tests constructing the same object with the same
irrelevant fields filled in.

## Determinism checklist

Before committing a test, confirm none of these is in play: current time or time zone, current
culture, a random value, a machine path, an environment variable, a network call, a fixed port, or
ordering that depends on a hash. Each of them is a future intermittent failure with a long
investigation attached.
