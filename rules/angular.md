---
paths: "**/*.component.ts,**/*.component.html,**/*.module.ts,**/*.service.ts,**/*.directive.ts,**/*.pipe.ts,**/*.guard.ts,**/angular.json"
---
# Angular — house facts

- Read the era from the files first: `bootstrapApplication`, `signal(`, `@if`, vitest → signals
  era (standalone); `AppModule`, `@ngrx/store`, `*ngIf`, karma → store era (modules). Never
  modernise in place.
- No `subscribe` without teardown (`takeUntilDestroyed`, the `async` pipe, a signal conversion);
  never a `subscribe` that only assigns a field.
- New code uses `inject()` where the file already does.
- Derived values: `computed`, not getters or lifecycle hooks; side effects belong in the handler
  that caused the change, not in an `effect`.
- One shared-state mechanism per app: the existing store or signal services, never both.

Procedure: skill `angular`.
