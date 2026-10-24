---
name: angular
description: >-
  Use when Angular code changes or breaks: `*.component.ts`, `*.module.ts`, `angular.json`, specs; a
  view not updating, a leaking subscription, a double request, TestBed failing.
paths: "**/angular.json,**/*.component.ts,**/*.component.html,**/*.module.ts"
---

# angular — the era decides the idiom

**Contract.** Code, reviews and fixes written in the project's own era · never modernises in place,
never mixes store and signal state in one app · code English, explanations Italian.

## When

- Writing, reviewing or debugging a component, service, store, form, route, interceptor or spec.
- Choosing between a signal, an observable and store state.
- A view does not update, a request fires twice, memory grows per navigation, TestBed fails in setup.

Not for: AngularJS (`.module('app', [...])`, `$scope`, no `angular.json`) — keep it running, port
features out, never modernise it; visual design, web-platform APIs and browser debugging → the
`frontend-design` and `modern-web-guidance` plugins, and driving the page itself → `browser-use`.

Facts also in `rules/angular.md` and `rules/typescript.md`, loaded when such a file is touched.

## Decide

### Era — read the files, never assume

| Evidence | Era |
| --- | --- |
| `@ngrx/store`, `karma` in `package.json`; `main.ts` bootstraps an `AppModule`; `*ngIf` / `*ngFor`; `strict` off | **store era** — modules, RxJS + NgRx, Material per feature module, Karma |
| `vitest`, no `karma`; `bootstrapApplication(...)`; `@if` / `@for`; `signal(` / `inject(` | **signals era** — standalone, signals, strict templates, vitest |
| a federation config plus host/remote entries in the build target | signals era with module federation — read the host manifest before touching a shared dependency |

Apps live in the `ClientApp` folder of an ASP.NET host: run `npm`/`npx` there. `npx ng version` names
the release. A signal in a store-fed module component, or a standalone component also declared in an
`NgModule`, is a hybrid no test setup covers: cross the era for a whole feature, on the ladder below.

### Signal, observable or store

| The value | Reach for |
| --- | --- |
| derived synchronously from other state, read in a template | `computed` — never a getter or a lifecycle hook |
| component-local UI state (open, selected tab, filter text) | `signal` (signals era) · a field with `OnPush` and immutable updates (store era) |
| an async stream needing cancel, retry, debounce or combination | RxJS; convert to a signal at the component edge in signals-era code |
| one HTTP call whose result renders | the observable consumed by the template (`async` pipe, or a signal conversion) |
| shared across unrelated features | a store: signal service with `readonly` computeds, or the existing NgRx store — one mechanism per app |
| something that must *happen* on a change | the handler that caused the change, not an `effect` |

### Do I need the store

```
Used by more than one feature, or must survive navigation?
├─ no  → component state. An action + reducer + selector for one filter is how a store rots.
└─ yes → NgRx already in the app?
          ├─ yes → follow it exactly: action, reducer, memoized selector, effect for I/O;
          │         never mutate in a reducer, never HTTP outside an effect.
          └─ no  → signal service: private writable signals, exported computeds, methods as the
                    only writers. No new store library.
```

### Types — beyond `rules/typescript.md`

| Rule | In practice |
| --- | --- |
| escape-hatch ladder, stop at the first rung that works | narrowing → `unknown` + guard → schema parse at the boundary → assertion function → `satisfies` → `as` to a narrower type with a comment; a forced suppression is `@ts-expect-error` with a reason, never `@ts-ignore` |
| `strict` off (store era) | price it with `npx tsc --noEmit --strict`, fix folder by folder; never a `@ts-nocheck` amnesty |
| the verdict | `npx tsc --noEmit -p tsconfig.app.json` on the build's project; editor green proves nothing |

### Migration ladder — one feature, one pull request

| Rung | Move |
| --- | --- |
| 1 Safe ground | `strict` on, `OnPush` where inputs are already immutable, derivation into selectors |
| 2 Templates and leaves | control-flow schematic per folder; leaf components standalone, still imported by their module |
| 3 Feature boundary | containers standalone, the empty module deleted, providers on the route, `loadComponent`, functional guards |
| 4 State | manual `subscribe` → template or signal conversion; store slices used by one feature → a signal service |

## Do

```powershell
npx ng version                          # release and builders; the CLI is never global
npx ng generate component features/orders/order-list --dry-run
npx ng build --configuration production
npx ng test --watch=false               # add --browsers=ChromeHeadless on Karma
npx tsc --noEmit -p tsconfig.app.json
npx ng generate @angular/core:control-flow   # official migrations: one folder, reviewed as a diff
npx ng generate @angular/core:standalone
```

## Traps

1. View does not update after a signal write → the object was mutated in place → `set`/`update` a new one.
2. `OnPush` ignores a change → the parent mutated the input → pass a new reference.
3. Two requests per page load → a cold HTTP observable, two subscribers → subscribe once, or `shareReplay`.
4. Stale results overwrite fresh ones while typing → nested `subscribe` cannot cancel → `switchMap`.
5. A saved payload lacks fields → `form.value` omits disabled controls → `getRawValue()`.
6. Errors vanish into an empty state → an interceptor mapped the error to a value → rethrow it.
7. A lazy route loads eagerly → a top-level import of the component → dynamic import in `loadComponent`.
8. One service instance per lazy chunk → provided in a lazy provider list → provide at root.
9. `inject()` throws → called in a callback or after an `await` → field initializer or constructor.
10. TestBed fails in setup → standalone components go in `imports`, declared ones in `declarations`.

## References

- `references/modern-signals.md` — signals era: bootstrap, providers, signal APIs, control flow.
- `references/legacy-modules-store.md` — store era: `NgModule` anatomy, NgRx selectors and effects, Material.
- `references/rxjs.md` — operator choice, subscription lifetime, cold and hot, errors, signal interop.
- `references/forms-http-routing.md` — typed reactive forms, interceptors, guards, lazy loading.
- `references/testing-and-migration.md` — the two harnesses, specs in each, the migration ladder in full.
