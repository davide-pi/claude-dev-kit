# The first test in code that has none

The largest platform here is a layered microservices estate of over a hundred projects with almost no
tests. The realistic goal is not coverage. It is: **the change I am about to make is protected, and
the next person can extend that protection.**

## Order of operations

```
Is there any test project for this service?
  no  -> create one, and write the host startup test first (it proves DI and config resolve)
Can I call the class under test without a database or a host?
  yes -> characterization test, then change
  no  -> find a seam (below). Still not testable in under an hour?
           -> sprout the new logic into a new tested class, and leave the old one alone
```

## The startup test, first

One test that boots the host in memory and requests one endpoint. It costs ten minutes and catches
missing registrations, captive dependencies, bad configuration binding and broken middleware order —
the failures that otherwise appear after deployment. In a service with no tests, this is the highest
value per line you will ever write. See `integration-host.md`.

## Characterization tests

Before changing behaviour you do not fully understand, pin down what it does **today**:

1. Call the method with realistic input.
2. Assert whatever it actually returns, even if it looks wrong. Run it, take the output, assert that.
3. Add a comment: this records current behaviour, not desired behaviour.
4. Now refactor. A red test means you changed something; decide whether you meant to.
5. When you deliberately change behaviour, update the test in the same commit as the code, so the
   diff shows the behaviour change explicitly.

This is the only technique that makes a risky refactor reviewable. Do not skip it because the code
"obviously" does X.

## Finding a seam

A seam is a place where behaviour can be changed without editing the code under test.

| Obstacle | Smallest honest change |
|---|---|
| Dependencies constructed inside the method | promote them to constructor parameters (existing callers keep working if you add a second constructor) |
| A static helper doing I/O | wrap it in an interface, inject the wrapper; the static stays for other callers |
| `DateTime.UtcNow` inline | inject a clock; a default parameter avoids touching every caller |
| A service locator lookup | pass the resolved dependency in |
| Configuration read from a static root | bind an options object and inject it |
| A sealed or internal type you must substitute | expose an interface, or test through the layer above |
| A `DbContext` created in the method | inject it, then use a real database test |

Each of these is a mechanical, reviewable refactor with no behaviour change. Do them one at a time,
committed separately from the feature, so a reviewer can see that nothing moved.

## Sprout and wrap

When the class resists testing and you cannot afford the refactor:

- **Sprout** — the new logic goes into a new class with its own tests; the old method calls it. The
  new code is covered, the old code is untouched, and the diff in the legacy file is one line.
- **Wrap** — you must change existing behaviour: rename the old method (keeping it intact), write a
  new method with the old name that calls the renamed one plus the new step. Both are visible, and
  the new step is testable in isolation.

Both leave the untested mass exactly as untested as before. That is the trade, and it is the right one
when the alternative is an untested change to a hundred-project estate.

## What to leave alone

| Leave it | Reason |
|---|---|
| Code you are not changing | tests written for their own sake rot and nobody trusts them |
| Generated code, migrations, snapshots | the generator is the contract |
| A trivial pass-through (controller action calling one service) | the test asserts the compiler |
| A class scheduled for deletion | write the test on its replacement |
| The whole estate, "for coverage" | a number nobody acts on, bought with weeks |

## Prioritizing, when you get to choose

Highest value first: code that has broken before; money, permissions, or data-loss paths; anything
with branching logic on more than two conditions; anything about to be changed. Lowest: DTOs,
mappings a compiler would catch, and thin wrappers.

`test-strategy` covers the risk-based decision in full; this file covers making it possible at all.

## Making it stick

- Put the test project next to the code, in the solution, so `dotnet test` finds it. A test project
  not in the solution will not run in the pipeline and will silently die.
- Wire it into the pipeline in the same pull request. A test suite that is not gating merges stops
  being maintained within weeks.
- Keep the fast lane fast from day one — the first slow test is what teaches everyone to skip the
  suite. See `suite-speed.md`.
- Copy the conventions of the two repositories here that do have solid tests, rather than inventing a
  third style. Check which assertion and substitute libraries they reference and use the same ones.
