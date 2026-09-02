# The modern era — standalone, signals, new control flow

## Shape of the application

| Piece | Where it lives | Rule |
| --- | --- | --- |
| bootstrap | `main.ts` → `bootstrapApplication(App, appConfig)` | no root `NgModule`; if one exists, this is the module era |
| providers | `app.config.ts` → `ApplicationConfig.providers`, built from `provide*` functions | router, HTTP client, interceptors and animations all arrive as `provide*` calls, not module imports |
| a component | standalone, its own `imports` array listing only what its template uses | an unused entry in `imports` is dead weight the bundler cannot always shake |
| a feature | a folder plus a route, not a module | there is no feature module to create; the route is the boundary |
| DI | `inject()` in field initializers | constructor injection still works and is fine; do not mix both styles inside one class |

`inject()` only works inside an injection context: field initializers, constructors, factory
providers, and functional guards/interceptors/resolvers. In a callback, a timer, or after an `await`
it throws. Capture what you need up front, or capture the injector and run inside it.

## Signals

| API | Purpose | Discipline |
| --- | --- | --- |
| `signal(initial)` | a writable state cell | keep it `private` in a service and expose a read-only view |
| `computed(fn)` | derived state, lazily recomputed and memoized | must be pure — no HTTP, no writes, no `Date.now()` if the template must be stable |
| `effect(fn)` | a side effect that reacts to signal reads | last resort; see below |
| signal-based `input` / `output` / view and content queries | component boundary as signals | availability varies by release — check what `@angular/core` exports in this project before using them |
| conversions between signals and observables | bridging RxJS at the component edge | the conversion helpers live in the RxJS interop entry point; see `rxjs.md` |

**Writes create a new reference.** `set(next)` or `update(prev => …)` with a fresh object. Mutating
the object inside a signal changes nothing the framework can observe, because equality is by
reference. The same applies to arrays: spread, do not `push`.

**`effect` is almost always the wrong tool.** Legitimate uses: syncing to something outside Angular
(storage, a non-Angular widget, the document title), and logging. Illegitimate and common: writing
another signal (use `computed`), fetching data (do it in the event that requires it, or a resolver),
and "reacting" to an input change (derive it instead). An effect that writes signals other effects
read is a loop waiting for a state shape it did not expect.

## New control flow

`@if` / `@else`, `@for` with a mandatory `track`, `@switch`, `@empty`, and deferred blocks where the
project's release has them (check `@angular/core` and the compiler's template syntax before using
`@defer`).

| Point | Detail |
| --- | --- |
| `track` is required in `@for` | it replaces the old trackBy function; track a stable id, never the index, or list state (focus, selection, inputs) jumps on reorder |
| built in, no imports | the structural-directive imports the old syntax needed disappear from `imports` — remove them, they are now dead |
| migration is mechanical | the official control-flow schematic converts a folder at a time; review the diff, especially nested `*ngIf` with `else` |
| templates get shorter | a nested `ng-container` chain usually collapses into one `@if` / `@else if` chain |

## Change detection consequences

- Signals inform the framework precisely which views to check, so an `OnPush` component driven only
  by signals updates without any manual marking. That is the point of moving state into signals.
- A component that mixes signals with mutated plain fields gets the worst of both: the signals notify,
  the fields do not, and the bug looks intermittent.
- Zoneless change detection removes the patched-async assumption entirely. Look for a zoneless
  provider in the bootstrap config and for the absence of the zone polyfill in `angular.json`
  `polyfills`. Under zoneless, anything that updates state outside a signal write — a raw
  `setTimeout` assigning a field, a third-party callback — will not render. Convert it to a signal
  write.
- Do not reach for manual `ChangeDetectorRef.detectChanges()` in new code. If it seems necessary, the
  state is not in a signal yet; that is the actual fix.

## Reviewing a modern component

1. Is every piece of rendered state a signal or a `computed`, or are there mutated fields left?
2. Any `effect` that writes state, fetches, or duplicates something a `computed` would express?
3. Does `@for` track a stable id?
4. Does the `imports` array contain only what the template uses?
5. Is `inject()` called anywhere it cannot be — inside a callback, a subscription, after an `await`?
6. Are the exposed members of a state service read-only, with methods as the only writers?
7. Is there any manual `subscribe` left that a signal conversion or the template would handle?
