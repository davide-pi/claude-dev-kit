# The modern era — standalone, signals, new control flow

## Shape of the application

| Piece | Where it lives | Rule |
| --- | --- | --- |
| bootstrap | `main.ts` → `bootstrapApplication(App, appConfig)` | no root `NgModule`; if one exists, this is the module era |
| providers | `app.config.ts` → `ApplicationConfig.providers` | router, HTTP client, interceptors and animations arrive as `provide*` calls |
| a component | standalone, `imports` lists only what its template uses | |
| a feature | a folder plus a route, not a module | |
| DI | `inject()` in field initializers | constructor injection is fine too; do not mix both styles in one class |

`inject()` only works in an injection context (field initializers, constructors, factory providers,
functional guards/interceptors/resolvers); in a callback, a timer, or after an `await` it throws.
Capture what you need up front, or capture the injector and run inside it.

## Signals

Availability of signal-based `input` / `output` / queries varies by release — check what
`@angular/core` exports in this project before using them. Signal/observable conversion helpers live in
the RxJS interop entry point (`rxjs.md`).

- Keep a writable `signal` `private` in a service and expose a read-only view; `computed` must be pure.
- **Writes create a new reference** (`set` / `update` with a fresh object or spread array): mutating the
  object inside a signal is invisible to the framework.
- **`effect` is almost always the wrong tool.** Legitimate: syncing to something outside Angular
  (storage, a non-Angular widget, the document title), logging. Illegitimate and common: writing
  another signal (use `computed`), fetching data (do it in the event, or a resolver), reacting to an
  input change (derive it).

## New control flow

Check `@angular/core` and the compiler's template syntax before using `@defer`.

- `track` is required in `@for`: track a stable id, never the index, or list state (focus, selection,
  inputs) jumps on reorder.
- The structural-directive imports the old syntax needed become dead in `imports`: remove them.
- Migration is mechanical via the official schematic, a folder at a time; review the diff, especially
  nested `*ngIf` with `else`.

## Change detection consequences

- A component mixing signals with mutated plain fields gets the worst of both: the bug looks
  intermittent.
- Zoneless: look for a zoneless provider in the bootstrap config and no zone polyfill in `angular.json`
  `polyfills`. Anything updating state outside a signal write (a raw `setTimeout` assigning a field, a
  third-party callback) will not render: convert it to a signal write.
- No `ChangeDetectorRef.detectChanges()` in new code: if it seems necessary, the state is not in a
  signal yet.

## Reviewing a modern component

1. Is every piece of rendered state a signal or a `computed`, or are there mutated fields left?
2. Any `effect` that writes state, fetches, or duplicates something a `computed` would express?
3. Does `@for` track a stable id?
4. Does the `imports` array contain only what the template uses?
5. Is `inject()` called anywhere it cannot be?
6. Are the exposed members of a state service read-only, with methods as the only writers?
7. Is there any manual `subscribe` left that a signal conversion or the template would handle?
