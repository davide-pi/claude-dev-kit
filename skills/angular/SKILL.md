---
name: angular
description: >-
  Use whenever Angular code is written, reviewed or debugged — a component, store, form, route or
  spec — or a view will not update, a subscription leaks, a request fires twice, TestBed fails, or an
  `any` or a cast is in question. Tells the NgRx/Karma era from the signals/vitest era.
---

# angular — two eras in these workspaces, one rule per era

## When

- Writing or reviewing any Angular component, service, store, form, route or interceptor.
- Deciding whether a piece of state should be a signal, an observable, or store state.
- A view does not update, a request fires twice, or a subscription leaks across navigation.
- Tests fail in setup and the harness in this project is not the one you last used.
- A type, a `tsconfig` option, an `any`, an `as` or a `!` is being written or reviewed.
- Moving a module-based feature toward standalone and signals without a rewrite.

Not for:

- The pre-TypeScript AngularJS generation — see the era table: read it, do not modernize it in place.
- Web-platform APIs, CSS features and Core Web Vitals → the `modern-web-guidance` plugin.
- Visual and UX design → the `frontend-design` plugin.
- Runtime browser debugging, accessibility auditing, load metrics and heap analysis → the
  `chrome-devtools-mcp` plugin.

## Decide

### Which era am I in — read the files, never assume

| Evidence in the project | Era, and what it means |
| --- | --- |
| no `angular.json`, no `tsconfig.json`; scripts calling `.module('app', [...])`, `.controller(`, `$scope` | **AngularJS**, the pre-TypeScript generation. Out of this skill's scope: keep it running, isolate it behind its own route or host page, and port features out of it rather than into it |
| `package.json` has `@ngrx/store`, `@angular/material` and `karma`; `main.ts` bootstraps an `AppModule`; `*ngIf` / `*ngFor` | **store era** (module-based) — the player-facing app: RxJS plus NgRx, Material modules per feature module, Karma harness, `strict` **off** in its `tsconfig` |
| `package.json` has `vitest`, no `karma`; `main.ts` calls `bootstrapApplication(...)`; `@if` / `@for`; `signal(` / `inject(` | **signals era** (standalone) — the back-office app: standalone, signals, `strict` plus strict templates on, vitest harness |
| a federation config file plus host/remote entries in the build target | signals era with native module federation — read the host manifest before touching a shared dependency |

Both apps live in the `ClientApp` folder of an ASP.NET host project: run every `npm`/`npx` command
from there, not from the solution root. `npx ng version` names the release; never assume it.

**Write in the project's era.** A signal dropped into a store-fed module component, or a standalone
component also declared in an `NgModule`, produces a hybrid nobody can reason about and no test setup
covers. Cross the line for a whole feature, deliberately, using the ladder in
`references/testing-and-migration.md`.

### Signal, observable, or store state

| The value | Reach for |
| --- | --- |
| derived synchronously from other state and read in a template | `computed` — never a field recalculated in a getter or a lifecycle hook |
| component-local UI state: open/closed, selected tab, filter text | `signal` (signals era) or a plain field with `OnPush` and immutable updates (store era) |
| an async stream needing cancellation, retry, debounce, or combination of several sources | RxJS — this is what it is for; convert to a signal at the component edge in signals-era code |
| one HTTP call whose result renders | the client's observable, consumed by the template (`async` pipe in store-era code, a signal conversion in signals-era code) — never a manual `subscribe` that assigns a field |
| state shared across unrelated features | a store: a signal-based service exposing `readonly` computeds (signals era), or the existing Redux-style store (store era). One mechanism per app, not both |
| something that must *happen* when state changes | not an `effect` — do it in the handler that caused the change |

### Do I need the store at all

```
Is the state used by more than one feature, or must it survive navigation?
├─ no  → component state (signal / field). Adding an action, a reducer and a selector
│         for one component's filter text is how a store becomes unreadable.
└─ yes → is this a store-era app with a Redux-style store already?
          ├─ yes → follow it exactly: action, reducer, memoized selector, effect for I/O.
          │         Never mutate state in a reducer; never call HTTP outside an effect.
          └─ no  → a signal-based service: private writable signals, exported computeds,
                    methods as the only writers. No new store library.
```

### Types — the house rules, in five lines

| Rule | In practice |
| --- | --- |
| `strict` is not negotiable | with it off, `null` fits every type and the compiler stops answering. New code compiles under it; where it is off, price it with `npx tsc --noEmit --strict` and fix folder by folder — never a `@ts-nocheck` amnesty |
| Climb the escape-hatch ladder, stop at the first rung that works | narrowing → `unknown` + type guard → schema parse at the boundary → assertion function → `satisfies` → `as` to a narrower type with a comment. Never `any`, `as any`, `!` or `@ts-ignore`; a forced one is `@ts-expect-error` with a reason |
| Data crossing in is unproven | an HTTP response, storage or a query string is parsed at the boundary, not described by an interface and trusted; contract types are generated, not hand-copied |
| Exclusive states are a union | a discriminated union on `status` with an exhaustive `switch` and a `never` default — not optional fields on one flat interface |
| The compiler on the build's project is the verdict | `npx tsc --noEmit` (and `--showConfig` for the merged `extends` chain); editor green proves nothing. No CLI is installed globally — always `npx` |

## Do

The Angular CLI is **not** installed globally here — always the local binary.

```powershell
npx ng version                         # what this project actually is; also lists the builders
npx ng generate --help                 # the schematics this project ships, before guessing a flag
npx ng generate component features/orders/order-list --dry-run   # inspect, then run for real
npx ng serve
npx ng build --configuration production
npx ng test --watch=false              # CI shape; add --browsers=ChromeHeadless on the Karma harness
npx ng lint
npx tsc --noEmit -p tsconfig.app.json   # types only; the spec project has its own tsconfig

.\node_modules\.bin\ng version         # when npx resolution is in doubt on PowerShell

# official migrations, one folder at a time, reviewed as a diff — not a whole-repo run
npx ng generate @angular/core:control-flow
npx ng generate @angular/core:standalone
```

## Traps

1. View does not update after a signal write — the object inside the signal was mutated in place, so
   reference equality saw no change — `set`/`update` with a new object.
2. `OnPush` component ignores a data change — the input object was mutated by its parent — pass a new
   reference, or move the state into a signal.
3. Memory grows and handlers fire twice per navigation — `subscribe` in a lifecycle hook with no
   teardown — `takeUntilDestroyed`, the template pipe, or a signal conversion; never a bare subscribe.
4. Two requests for one page load — the HTTP observable is cold and has two subscribers — subscribe
   once, or `shareReplay` with reference counting.
5. Stale results overwrite fresh ones on fast typing — nested `subscribe` cannot cancel — `switchMap`.
6. A saved payload is missing fields — `form.value` omits disabled controls — `getRawValue()`.
7. Errors vanish and the component shows an empty state — an interceptor mapped the error to a value —
   rethrow, or map to an explicit failure the caller must handle.
8. A lazy route loads eagerly — the route file imports the component at the top — dynamic import in
   `loadComponent` / `loadChildren`.
9. A service has one instance per lazy chunk — it was provided in a lazily loaded provider list —
   provide it at the root injector, or accept the scoping deliberately.
10. `inject()` throws — it was called in a callback or after an `await`, outside the injection context
    — call it in a field initializer or constructor, or capture the injector.
11. An `effect` writes a signal another `effect` reads — a loop, or a change-detection warning —
    derive with `computed` instead.
12. Tests fail in `TestBed` setup — the harness pattern differs by era: a standalone component is
    `imports`, a declared one is `declarations` — see the testing reference.

## References

- `references/modern-signals.md` — the standalone and signal era: bootstrap, providers, signal APIs,
  new control flow, change-detection consequences.
- `references/legacy-modules-store.md` — the module era: `NgModule` anatomy, the Redux-style store,
  selectors and effects, the Material component library.
- `references/rxjs.md` — operators that matter, subscription lifetime, cold and hot, error handling,
  signal interop.
- `references/forms-http-routing.md` — typed reactive forms, interceptors and error handling, routing,
  guards and lazy loading.
- `references/testing-and-migration.md` — both test harnesses and how to tell them apart, plus the
  incremental migration ladder from module-based to modern.
