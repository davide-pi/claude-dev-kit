# Component testing — the modern runner plus a component-testing library

There is no browser-driving or visual-regression tooling in these workspaces: no end-to-end runner, no
component explorer. Component tests are the **only** automated safety net, so they must cover the
wiring — rendering, interaction, async states — not just pure functions.

## Orientation

Read `package.json` first: the scripts are what CI runs, and the devDependencies name the runner and
the testing library. Then look for the test config (its own file, or a `test` block inside
`vite.config.ts`) and the setup file, which registers the matchers and the DOM cleanup.

```powershell
npm test -- --run                    # single pass, the CI shape
npm test -- --run src/features/orders
npm test -- --run -t "submits the form"
npm test -- --coverage --run
npm test                             # watch mode, the local default
```

Flags go after `--` when invoked through `npm run`. The runner shares the Vite config, so aliases and
env modes behave in tests exactly as in the app — if a test cannot resolve an alias, the alias is
missing from `vite.config.ts` rather than from the test setup.

## What to assert

Test what a user can perceive and do. That is not a style preference: it is what makes a test survive
a refactor.

| Assert on | Not on |
| --- | --- |
| visible text, labels, roles, form values | class names, component internals, state variables |
| what happens after a click or a keystroke | that a handler prop was called, when the effect is observable |
| the rendered loading, error and empty states | the order of internal renders |
| that a request was made with the expected method, URL and body | how many times an effect ran |

Query priority: role and accessible name first, then label text, then visible text, then a test id as
the deliberate last resort. A test that reaches for a class selector is asserting on markup and will
break on the next styling change for no functional reason.

## What to fake

| Dependency | Approach |
| --- | --- |
| HTTP | intercept at the network layer (a request-mocking layer, or a stubbed `fetch`) so the component's own data hook is exercised — mocking the hook itself tests nothing about the fetching |
| the router | render inside a memory router with the route and params the test needs |
| context providers | a small `renderWithProviders` helper wrapping the real providers with test values — not a mock of the context |
| timers | the runner's fake timers, advanced explicitly; never a real wait |
| dates and randomness | inject or freeze them; a snapshot containing today's date fails tomorrow |
| child components | almost never — stubbing children hides integration bugs, which is the class of bug these tests exist to catch |

## Async, and the flakiness it causes

- Use the library's async queries (`findBy*`) or the wait helper rather than a fixed delay. A test
  containing a sleep is a test that fails on a slower machine.
- The user-event style API (async, one `await` per interaction) reflects real interaction better than
  firing raw events, and it avoids most act-related warnings.
- An act warning means state settled after the assertion: await the interaction, or await the element
  that appears as a result. Suppressing the warning hides the race, it does not fix it.
- Assert the negative too: after a failed request, the loading indicator is **gone** and the error is
  shown. Half these bugs are a spinner that never clears.
- Clean up between tests (usually automatic in the setup file); a leaked provider or timer makes the
  next test fail for reasons unrelated to it.

## Hooks and pure logic

- Test a custom hook through a component that uses it, or with the library's hook-rendering helper.
  Prefer the component when the hook's whole point is what it renders.
- Reducers, formatters and validators are plain functions: test them directly, exhaustively and
  cheaply, and keep the component tests for wiring.

## What to write first in a project with almost no tests

1. One render-and-interact test per screen with faked data — it catches the crash-on-render class of
   bug immediately and costs almost nothing.
2. The data hooks: loading, success, failure, abort.
3. Forms: validation messages, disabled submit, double-submit prevention, server-error mapping.
4. Reducers and pure helpers.
5. Then fill in the rest by risk, not by coverage percentage.

Coverage is a diagnostic, never a target. A high number over untested branches proves only that the
lines executed.

## Traps

1. Test passes alone, fails in the suite — leaked state, a fake timer left installed, or a shared
   module-level cache — reset in the setup file.
2. Act warnings during async updates — an interaction or a resulting element was not awaited.
3. A query finds nothing that is visibly on screen — it is inside a portal, or the query is scoped to
   a container that does not include it.
4. Every test needs the same six providers — that is a missing `renderWithProviders` helper, not a
   reason to stub the providers away.
5. A snapshot test that gets updated on every change — it asserts nothing. Delete it and assert the
   two things that actually matter.
6. Tests mock the app's own data hook and pass while the real fetch is broken — intercept the network
   instead.
