# Testing in both harnesses, and the migration ladder

There is no browser-driving or visual-regression tooling in these workspaces — no end-to-end runner
and no component explorer. Component and service tests are the **only** automated safety net, which
raises the bar for them: they have to cover the wiring, not just the pure functions.

## Which harness am I in

| Evidence | Harness | Run it with |
| --- | --- | --- |
| `karma.conf.js` at the project root, a test entry file listed in `angular.json` | **Karma era**, with Jasmine as the framework | `npx ng test --watch=false --browsers=ChromeHeadless` |
| no `karma.conf.js`; `angular.json`'s `test` target on a modern builder, plus a spec setup file | **modern runner** (read the builder name in `angular.json` to know which one) | `npx ng test --watch=false`, or the runner's own binary via `npx` if `package.json` defines a script |
| `package.json` scripts referencing a runner directly | trust the script — it is what CI runs | `npm test` |

Check `angular.json` → `projects.<name>.architect.test.builder` and the devDependency names in
`package.json`. Never assume from another project in the same repo: a monorepo here can have both.

Differences that actually change test code:

| Aspect | Karma era | Modern runner |
| --- | --- | --- |
| where it runs | a real browser process | the runner's environment configured in the project (browser mode or a DOM shim) |
| globals | Jasmine globals available implicitly | usually imported explicitly from the runner — follow the existing specs |
| spies / mocks | `jasmine.createSpyObj` | the runner's mock API |
| watch feedback | slow start, browser reload | fast, and the default in local development |
| failure noise | one browser error can fail the whole run | isolated per file |

Whatever the harness, the `TestBed` API is the same. Only the surrounding framework differs — so
port the assertions, not the setup.

## TestBed patterns

| Component style | Setup |
| --- | --- |
| standalone | `TestBed.configureTestingModule({ imports: [TheComponent] })`; replace a child with a stub via `TestBed.overrideComponent(...)` or by overriding the provider it depends on |
| declared in an NgModule | `declarations: [TheComponent]` plus the modules its template needs in `imports` — declaring it *and* importing its module is a duplicate-declaration error |

Rules for both:

- Provide fakes, not the real thing: the HTTP testing backend, a stubbed router, a fake store or a
  selector override. A test that reaches the network is not a unit test and will flake.
- Assert through the rendered DOM for a component test (what the user sees), through the class for a
  service. Testing a component's private fields is testing the implementation.
- After changing state, run the framework's stabilization step the existing specs use (a detect-changes
  call or the async stabilization helper) before asserting — a missing one is the classic
  "the assertion sees the previous render" failure.
- HTTP: use the testing backend, `expectOne` with the URL **and** method, flush the response, then
  `verify()` in teardown so an unexpected extra request fails the test rather than passing silently.
- Signals: read them directly in the assertion; a `computed` is evaluated on read, so no scheduling is
  involved. An `effect` needs the stabilization step to have run.
- RxJS: prefer a synchronous source (`of`) and assert the emitted value. Reach for marble testing only
  for time-dependent operators (debounce, retry with backoff) where wall-clock waiting would be flaky.
- A UI component library that ships test harnesses: use them. Querying its internal DOM classes
  produces tests that break on a library upgrade for no functional reason.
- What to test first in a project with almost none: the reducer/selector pure functions (cheapest),
  then the services with branching, then one smoke test per screen that it renders with fake data.

## The migration ladder — module-based toward modern

The unit of migration is **one feature, one pull request**. A half-migrated feature is the only
outcome worse than not starting.

| Rung | Move | Why in this order |
| --- | --- | --- |
| 0 | `strict` on, `OnPush` on components whose inputs are already immutable, derivation moved into selectors | cheap, no architecture change, and it exposes the mutation bugs the next rungs would otherwise inherit |
| 1 | templates to the new control flow, one folder at a time via the official schematic | mechanical and reviewable; removes structural-directive imports |
| 2 | leaf components to standalone via the official schematic — the owning `NgModule` keeps importing them | standalone components work fine inside a module, so this rung is not a cliff |
| 3 | the feature's own container components to standalone, then delete the now-empty feature module and move its providers to the route | the module disappears only once nothing declares anything |
| 4 | the route to `loadComponent` / a lazily loaded `Routes` array, and guards to functional guards | routing is the feature's boundary; this is where it becomes independent |
| 5 | manual `subscribe` → template consumption → signal conversion; component-local state to signals | now the component is standalone, signals do not fight a module's change-detection assumptions |
| 6 | store slices used by exactly one feature to a signal-based service with private writable signals | only after the feature is otherwise modern, and never for cross-feature slices |

Do not:

- start at rung 6 — replacing the store first leaves every feature reading from two sources of truth;
- convert leaf components across ten features at once — the diff is unreviewable and nothing is
  finished;
- introduce signals into a component still fed by mutated store state — the mutation is invisible to
  the signal and the bug looks intermittent;
- run a whole-repo schematic and commit it unread. Run it per folder, read the diff, run the tests.

Done when: the only `NgModule` left is the root one (or none), `main.ts` bootstraps a standalone root,
no template uses the old structural directives, and every remaining `subscribe` has a stated reason.
