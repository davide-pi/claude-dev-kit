# The module era — NgModule, the Redux-style store, Material

Two apps here live in this era, and they are not going to be rewritten. The goal is to work in them
correctly and to leave every touched feature slightly closer to the modern style — not to introduce
a second architecture beside the first.

## NgModule anatomy

| Field | Means | Common mistake |
| --- | --- | --- |
| `declarations` | components, directives and pipes this module owns | declaring the same component in two modules — a hard error that reads like a template error |
| `imports` | other modules whose exported declarables this module's templates use | importing a whole UI library module in every feature module instead of a curated shared module |
| `exports` | what other modules get when they import this one | exporting everything, which makes the module a synonym for "all of it" |
| `providers` | services scoped to this injector | providing a service here **and** at root, which yields two instances and a bug that looks like lost state |
| `entryComponents` | legacy dynamic-component registration | if present, it is dead in current releases — check before deleting |

Module layout that works: one `SharedModule` exporting the curated UI set (declarables only, no
providers), one `CoreModule` imported exactly once by the root module for app-wide providers, and one
module per feature, lazily loaded through the router. A provider in a lazily loaded module gets a new
instance per chunk — that is the single most misdiagnosed defect in this era.

## The Redux-style store

Follow it exactly where it exists; a partial adoption is worse than either option alone.

| Piece | Rule |
| --- | --- |
| action | one per event that happened, named after the event and its source, never after the reducer's intent |
| reducer | pure, returns a new state object; never mutates, never calls a service, never reads outside its slice |
| selector | the only read path — memoized, composed from other selectors, never a raw `state.x.y` in a component |
| effect | the only place I/O happens; every effect maps errors to a failure action and must not let the stream die |
| feature state | registered by the lazily loaded feature module, so the slice appears with the chunk |

Non-negotiables in practice:

- **Never mutate state in a reducer.** Spread, or use the entity helpers the store library provides.
  A mutation appears to work until a memoized selector sees the same reference and stops emitting.
- **An effect that throws is gone.** An unhandled error completes the effect's stream and the app
  silently stops responding to that action for the rest of the session. Catch inside the inner
  observable (`catchError` on the `switchMap`'s inner stream, not on the outer one) and dispatch a
  failure action.
- **`switchMap` for cancellable loads, `concatMap` for writes that must not reorder, `mergeMap` only
  when order is genuinely irrelevant, `exhaustMap` for a submit that must ignore double-clicks.** The
  choice is part of the effect's contract, not a style preference.
- **Selectors carry the derivation.** Filtering or sorting in a component means every subscriber
  recomputes it and none of it is memoized.
- **Do not put a component's own filter text in the store.** Store state is what more than one
  feature needs, or what must survive navigation. Everything else is component state.
- Entity collections belong in the store library's entity adapter: normalized ids plus a dictionary.
  Arrays of entities in state produce O(n) updates and selectors that recompute on every change.

## RxJS in components of this era

- The `async` pipe is the default consumption path: it subscribes, unsubscribes and marks for check.
  Prefer one `vm$` observable combining what the template needs over five separate pipes.
- Where a manual subscription is unavoidable, tear it down: a destroy subject with `takeUntil`, or the
  modern `takeUntilDestroyed` if the release provides it.
- `OnPush` on every component, with immutable inputs. Without it, a store-driven app re-checks the
  whole tree on every emission.
- Keep `subscribe` out of services entirely: a service returns an observable, the caller decides when
  it runs.

## The Material component library

| Point | Detail |
| --- | --- |
| imports | import only the component modules a feature uses, re-exported from the shared module — not the whole library |
| theming | one theme file; component-level colour overrides are how a design drifts. Visual and UX direction is the `frontend-design` plugin's territory, not this skill's |
| overlays | dialogs, menus and tooltips render outside the component tree — anything scoped by a parent selector will not reach them |
| forms | the field wrapper expects a form control; a custom control must implement the value-accessor interface properly, including the disabled state |
| testing | the library ships component test harnesses — use them instead of querying internal DOM classes, which change between releases |
| accessibility | the library provides the a11y primitives; auditing the result is the `chrome-devtools-mcp` plugin's job |

## When touching a feature in this era

1. Do not add a new architecture: no second store, no signals inside a store-fed component.
2. Do add `OnPush` if it is missing and the component's inputs are already immutable.
3. Do move derivation from the component into a selector.
4. Do convert a manual subscription into the `async` pipe.
5. Record what the feature would need to cross to the modern style — the ladder is in
   `testing-and-migration.md`.
