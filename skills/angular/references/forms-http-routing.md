# Forms, HTTP and routing

## Reactive forms — typed, always

Template-driven forms are not used for anything non-trivial here: they cannot be typed usefully, they
hide validation state, and they make testing awkward. Build every real form reactively.

| Point | Rule |
| --- | --- |
| typing | build the group from an explicit interface of controls, so `value` and `controls` are typed. If the release supports it, `NonNullableFormBuilder` removes the `null` from every control type — check what `@angular/forms` exports before assuming |
| nullability | a plain control's value type includes `null` (reset sets it) — either accept it in the type or use the non-nullable builder |
| `value` vs `getRawValue()` | `value` **omits disabled controls**; a payload built from it silently loses fields. Use `getRawValue()` whenever disabled controls hold real data |
| validators | synchronous validators are pure functions returning an error map or `null`; async validators return an observable that must complete |
| cross-field rules | on the group, not on a control — a control validator cannot see its siblings |
| dynamic sections | `FormArray` with a typed element; keep a helper that pushes a fully built group, never a partial one |
| custom controls | implement the value-accessor interface completely, including `setDisabledState`, or the control breaks inside a UI-library field wrapper |
| updates | `setValue` requires the whole shape, `patchValue` accepts a subset and silently ignores unknown keys — a typo in a patch key is not an error |
| status | drive the UI from `touched`/`dirty` plus `invalid`, not from `invalid` alone, or the form shows errors before the user typed |
| submission | disable on `invalid` **or** in-flight; use `exhaustMap` on the submit stream so a double click cannot send twice |

## HTTP and interceptors

Interceptor order is the order they are registered. Compose them as a chain of single-purpose
interceptors, not one that does everything:

| Interceptor | Responsibility | Trap |
| --- | --- | --- |
| auth | attach the token; refresh once and retry on an auth failure | a refresh that itself triggers the interceptor loops — exclude the refresh URL |
| error mapping | turn a transport error into the app's typed failure | never map to a success value; the caller then cannot tell |
| correlation / tracing | add a request id header | keep it out of the auth interceptor |
| loading indicator | count in-flight requests | must decrement in `finalize`, or a failed request leaves the spinner up |
| retry | idempotent reads only, bounded, excluding client errors | retrying a POST duplicates writes |

Other HTTP rules:

- The response type is a claim, not a check. Validate at this boundary — see `typescript`,
  `references/boundaries.md`.
- Keep DTO shapes inside the data layer and map to domain models before components see them.
- Cancellation is free with `switchMap`; use it for anything the user can retrigger.
- In modern apps interceptors are functional and registered through the HTTP `provide*` call; in
  module apps they are classes registered in the interceptor multi-provider. Match the project.

## Routing

| Concern | Modern era | Module era |
| --- | --- | --- |
| route config | a `Routes` array per feature folder, composed in `app.routes.ts` | a routing module per feature module |
| lazy loading | `loadComponent: () => import('...')` for a single screen, `loadChildren` for a route subtree | `loadChildren` with a dynamic import to the feature module |
| guards | functional guards using `inject()` | class guards implementing the guard interface |
| data loading before activation | a resolver, or load in the component and render a loading state | same |
| route-driven state | read params as a stream (or a signal conversion) — never once in a lifecycle hook | same |

Rules that hold in both:

- **Read params reactively.** A component reused across two ids (`/orders/1` → `/orders/2`) does not
  re-run its constructor; a one-shot read leaves the old data on screen.
- **A lazy route must not be imported statically anywhere.** One top-of-file import of the component
  puts it back in the initial bundle, and nothing warns you. Verify with a build and look at the
  chunk list.
- **Guards decide, they do not load.** A guard that fetches and stores data makes navigation slow and
  untestable; use a resolver, or load in the target component.
- Prefer a resolver only when the screen genuinely cannot render without the data. Otherwise a
  loading state is better than a blocked navigation.
- Preloading strategies are worth it for the next likely route; measure before adding one, and
  measure with the `chrome-devtools-mcp` plugin rather than by feel.

## Module federation, where present

One modern app uses native module federation. Extra rules for it:

- Shared dependencies must be shared **consistently** — the framework runtime and the UI library
  cannot be duplicated across host and remotes without producing two injector trees and confusing
  errors. Read the federation config before adding or bumping a shared dependency.
- A remote's routes are lazily loaded through the host's route config; a failed remote must degrade
  to an error route, not a blank screen.
- Test the remote standalone and through the host: a provider available in the host but declared only
  there will resolve in the composed app and fail in the remote's own tests.
