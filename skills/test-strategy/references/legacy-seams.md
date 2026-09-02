# Adding tests to code that has none

The realistic case in these workspaces: the largest solution has a handful of test files across
more than a hundred projects, while the newest work has a full pyramid. This file is about the
first case — code that was never designed to be tested, and now has to change.

## The order of operations

1. **Do not refactor to make it testable first.** That is an untested refactor of untested code.
2. **Find a seam** — a place where behaviour can be observed or replaced without editing the logic.
3. **Characterize** the current behaviour through that seam, bugs included.
4. **Commit the tests alone**, with no production change. They now describe reality.
5. **Change the code.** A characterization test that breaks is either the intended change (update
   it, and say so in the commit) or a regression (stop).
6. **Grow outward** from that seam only when the next change needs it.

## Finding the seam

| Situation | Seam | Cost |
|-----------|------|------|
| A public method with parameters in and a value out | The method itself | Free |
| Logic buried in a method that also does IO | Extract the logic into a new method or class, called from the old one | Small, mechanical |
| Logic in a controller or a page handler | Test through the host with the boundary substituted | Small |
| A `new` of a concrete dependency inside the method | Promote it to a constructor parameter; keep a default for existing callers | Small |
| A static or singleton accessor | Wrap it behind an interface, delegate the default to the static | Small |
| `DateTime.Now`, `Guid.NewGuid()`, `Random`, the file system | Inject a provider; there is no other way to test time-dependent code | Small |
| Nothing injectable, huge method, no boundary at all | Sprout: write the new behaviour in a new, tested class and call it from one line in the old code | Smallest possible change |
| Behaviour only observable through the database | Integration test with a real engine and a transaction per test | Seconds per test |
| Code you cannot compile against or have no source for | `ilspycmd` to read it, then test your own wrapper around it | Read-only |

**Sprout and wrap first, extract later.** Adding a call to new, tested code changes one line of the
legacy path. Reorganising the legacy path changes all of it, untested.

## Characterization — asserting what *is*

A characterization test is not a specification. It records the behaviour so a change becomes
visible. Write it even when the current behaviour is obviously wrong, and mark it:

```csharp
// CHARACTERIZATION: records current behaviour, not intended behaviour.
// A negative quantity returns 0 instead of throwing. See <work item>.
```

The workflow:

1. Call the code with a realistic input and assert something deliberately wrong.
2. Run it. The failure message contains the actual value.
3. Replace the assertion with that value.
4. Repeat for the inputs that matter: boundaries, empty, null, the largest realistic case, and one
   input from real data.

For output too large to assert field by field, use a golden master: serialize the result to a
stable format, store it beside the test, and compare. Keep it small enough to be reviewed by eye —
a golden master nobody can read is a test nobody can trust.

```csharp
var actual = JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
var expected = File.ReadAllText("Golden/order-summary.json");
actual.Should().Be(expected);   // regenerate deliberately, never automatically in CI
```

Rules for a golden master: no timestamps, no generated ids, no dictionary ordering, no culture-
dependent formatting inside it — or it flakes on the first machine change.

## Breaking dependencies without a rewrite

| Dependency | Minimal move | Watch out for |
|-----------|--------------|---------------|
| Concrete class constructed inline | Optional constructor parameter with the current default | Do not change every call site in the same commit |
| Static helper | Interface plus a thin default implementation delegating to the static | Keep the static; other callers still use it |
| Clock | An abstraction with a single "now" member, injected | Every use of "now" must go through it, or the test still flakes |
| Configuration read directly | Pass the value in, or bind an options type | Reading configuration in a domain class is the real defect |
| HTTP call | Interface for the operation, not for the client | Mocking the raw client makes brittle tests |
| Database through an ORM | Test with a real engine instead of substituting the context | An in-memory provider does not translate SQL the same way |
| A message broker | Test the handler as a plain method with the message as input | Transport belongs to an integration test, not this one |

## The frontend equivalent

| Situation | Seam |
|-----------|------|
| Logic inside a component | Move it to a service or a plain function, test that; component keeps only rendering |
| A component with inputs and outputs | Test through the component API: set inputs, assert rendered output and emitted events |
| Direct HTTP in a component | Move to a service, substitute the service in the test |
| Legacy Angular with the older runner | Keep its existing runner; do not migrate the harness to add one test |
| New Angular or React | The project's existing runner, component tests for behaviour only |

## Knowing when to stop

Stop adding tests when the next test would cover a path that cannot lose money, leak data or
corrupt state, and the change at hand does not touch it. Note the gap in the change description
instead. A gap that is written down is a decision; a gap that is not is an accident.

To close a large gap deliberately, fan out the `test-writer` agent over the highest-risk classes,
one class per agent, each instructed to follow the patterns already present in that repository —
not to introduce its own.
