---
paths: "**/*.component.ts,**/*.component.html,**/*.module.ts,**/*.service.ts,**/*.directive.ts,**/*.pipe.ts,**/*.guard.ts,**/angular.json"
---
# Angular — house facts

- Read the era from the files before any edit; never modernise in place, never mix eras in one
  feature. Store era: `@ngrx/store` or `karma`, `AppModule`, `*ngIf`/`*ngFor`, `strict` off. Signals
  era: `vitest`, `bootstrapApplication`, `@if`/`@for`, `signal(`/`inject(`. AngularJS (`$scope`, no
  `angular.json`) is never modernised. Apps live in `ClientApp`: run `npm`/`npx` there.
- No `subscribe` without teardown (`takeUntilDestroyed`, the `async` pipe, a signal conversion);
  never a `subscribe` that only assigns a field.
- New code uses `inject()` where the file already does; it throws in a callback or after an `await`.
- Derived values: `computed`, not getters or lifecycle hooks; side effects belong in the handler
  that caused the change, not in an `effect`.
- Shared state, one mechanism per app: component state unless used by several features or kept across
  navigation; then the existing NgRx (action, reducer, memoized selector, effect for all I/O) or a
  signal service (private signals, exported computeds, methods as the only writers). No new library.
- A signal write or `OnPush` input that does not render means an in-place mutation: pass a new object.
- Two requests per load: a cold observable with two subscribers (`shareReplay`). Stale results
  overwriting fresh: nested `subscribe`, use `switchMap`.
- `form.value` omits disabled controls: use `getRawValue()` for a payload. An interceptor rethrows
  errors, never maps them to a value.
- Lazy routes: `loadComponent` with a dynamic import; provide shared services at root.
- Verdict: `npx tsc --noEmit -p tsconfig.app.json` and `npx ng test --watch=false`; official
  migrations (`@angular/core:control-flow`, `:standalone`) one folder, one pull request.
