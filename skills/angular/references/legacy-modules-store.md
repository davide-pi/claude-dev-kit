# The module era — NgModule, the Redux-style store, Material

Two apps here live in this era, and they are not going to be rewritten. The goal is to work in them
correctly and to leave every touched feature slightly closer to the modern style — not to introduce
a second architecture beside the first.

## NgModule layout

One `SharedModule` exporting the curated UI set (declarables only, no providers), one `CoreModule`
imported exactly once by the root module for app-wide providers, one module per feature, lazily loaded
through the router.

- A provider in a lazily loaded module gets a new instance per chunk — the most misdiagnosed defect in
  this era. Providing a service in a module **and** at root yields two instances and a bug that looks
  like lost state.
- Declaring a component in two modules is a hard error that reads like a template error.
- `entryComponents`, if present, is dead in current releases — check before deleting.

## The Redux-style store

Follow it exactly where it exists; a partial adoption is worse than either option alone.

- Actions are named after the event and its source, never after the reducer's intent.
- Reducers are pure and never mutate: a mutation appears to work until a memoized selector sees the
  same reference and stops emitting.
- Selectors are the only read path; filtering or sorting in a component is recomputed per subscriber.
- Effects are the only place I/O happens. **An effect that throws is gone**: an unhandled error
  completes its stream and the app stops responding to that action for the session. Put `catchError` on
  the `switchMap`'s inner stream, not the outer one, and dispatch a failure action.
- `switchMap` for cancellable loads, `concatMap` for writes that must not reorder, `mergeMap` only
  when order is irrelevant, `exhaustMap` for a submit that ignores double-clicks: part of the effect's
  contract.
- A component's own filter text does not go in the store: store state is what more than one feature
  needs or what must survive navigation.
- Entity collections use the store library's entity adapter, not arrays.
- Feature state is registered by the lazily loaded feature module.

## RxJS in components of this era

- `async` pipe by default; prefer one `vm$` observable over five pipes.
- A manual subscription is torn down (`takeUntil` on a destroy subject, or `takeUntilDestroyed` if the
  release provides it); services never `subscribe` — they return the observable.
- `OnPush` on every component, with immutable inputs.

## The Material component library

- Import only the component modules a feature uses, re-exported from the shared module.
- One theme file; component-level colour overrides are how a design drifts. Visual direction is the
  `frontend-design` plugin's territory.
- Overlays (dialogs, menus, tooltips) render outside the component tree: parent-scoped selectors do
  not reach them.
- Use the library's test harnesses, not its internal DOM classes (they change between releases).
- Accessibility auditing in a real browser is `browser-use`'s job.

## When touching a feature in this era

1. Do not add a new architecture: no second store, no signals inside a store-fed component.
2. Do add `OnPush` if it is missing and the component's inputs are already immutable.
3. Do move derivation from the component into a selector.
4. Do convert a manual subscription into the `async` pipe.
5. Record what the feature would need to cross to the modern style — the ladder is in
   `testing-and-migration.md`.
