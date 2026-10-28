# Testing in both harnesses, and the migration ladder

There is no browser-driving or visual-regression tooling in these workspaces — no end-to-end runner
and no component explorer. Component and service tests are the **only** automated safety net, so they
have to cover the wiring, not just the pure functions.

## Which harness am I in

| Evidence | Harness | Run it with |
| --- | --- | --- |
| `karma.conf.js` at the project root, a test entry file listed in `angular.json` | **Karma era**, with Jasmine | `npx ng test --watch=false --browsers=ChromeHeadless` |
| no `karma.conf.js`; `angular.json`'s `test` target on a modern builder, plus a spec setup file | **modern runner** (read the builder name in `angular.json`) | `npx ng test --watch=false`, or the runner's own binary via `npx` if `package.json` defines a script |
| `package.json` scripts referencing a runner directly | trust the script — it is what CI runs | `npm test` |

Check `angular.json` → `projects.<name>.architect.test.builder` and the devDependency names. Never
assume from another project in the same repo: a monorepo here can have both.

Karma era: Jasmine globals implicit, `jasmine.createSpyObj`. Modern runner: usually explicit imports
from the runner, its own mock API — follow the existing specs. `TestBed` is the same in both: port the
assertions, not the setup.

## TestBed patterns

| Component style | Setup |
| --- | --- |
| standalone | `TestBed.configureTestingModule({ imports: [TheComponent] })`; stub a child via `TestBed.overrideComponent(...)` or the provider it depends on |
| declared in an NgModule | `declarations: [TheComponent]` plus the modules its template needs in `imports` — declaring it *and* importing its module is a duplicate-declaration error |

- Provide fakes (HTTP testing backend, stubbed router, fake store or selector override); a test that
  reaches the network will flake.
- Assert through the rendered DOM for a component, through the class for a service.
- Run the stabilization step the existing specs use before asserting ("the assertion sees the previous
  render").
- HTTP: `expectOne` with the URL **and** method, flush, then `verify()` in teardown so an unexpected
  extra request fails the test.
- Signals: read directly; a `computed` is evaluated on read; an `effect` needs the stabilization step.
- RxJS: synchronous source (`of`); marble testing only for time-dependent operators.
- Use the UI library's test harnesses, not its internal DOM classes.
- A project with almost no tests: reducer/selector pure functions first, then services with branching,
  then one smoke test per screen with fake data.

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

- start at rung 6 — every feature would read from two sources of truth;
- convert leaf components across ten features at once — the diff is unreviewable and nothing is finished;
- introduce signals into a component still fed by mutated store state;
- run a whole-repo schematic and commit it unread: per folder, read the diff, run the tests.

Done when: the only `NgModule` left is the root one (or none), `main.ts` bootstraps a standalone root,
no template uses the old structural directives, and every remaining `subscribe` has a stated reason.
