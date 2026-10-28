# Forms, HTTP and routing

## Reactive forms — typed, always

Template-driven forms are not used for anything non-trivial here. Build every real form reactively.

| Point | Rule |
| --- | --- |
| typing | build the group from an explicit interface of controls. `NonNullableFormBuilder` removes the `null` from every control type — check what `@angular/forms` exports before assuming |
| `value` vs `getRawValue()` | `value` **omits disabled controls**; a payload built from it silently loses fields. Use `getRawValue()` whenever disabled controls hold real data |
| cross-field rules | on the group, not on a control — a control validator cannot see its siblings |
| custom controls | implement the value-accessor interface completely, including `setDisabledState`, or the control breaks inside a UI-library field wrapper |
| updates | `patchValue` silently ignores unknown keys — a typo in a patch key is not an error |
| status | drive the UI from `touched`/`dirty` plus `invalid`, not `invalid` alone |
| submission | disable on `invalid` **or** in-flight; `exhaustMap` on the submit stream so a double click cannot send twice |

## HTTP and interceptors

Compose a chain of single-purpose interceptors, in registration order:

| Interceptor | Trap |
| --- | --- |
| auth: attach the token; refresh once and retry | a refresh that itself triggers the interceptor loops — exclude the refresh URL |
| error mapping | never map to a success value; the caller then cannot tell |
| loading indicator | must decrement in `finalize`, or a failed request leaves the spinner up |
| retry | idempotent reads only, bounded, excluding client errors — retrying a POST duplicates writes |

- The response type is a claim, not a check. Parse it at this boundary — the type house rules in the
  `angular` SKILL.md.
- Keep DTO shapes inside the data layer and map to domain models before components see them.
- Modern apps: functional interceptors via the HTTP `provide*` call; module apps: class interceptors in
  the interceptor multi-provider. Match the project.

## Routing

Modern era: a `Routes` array per feature folder composed in `app.routes.ts`, `loadComponent` /
`loadChildren`, functional guards with `inject()`. Module era: a routing module per feature,
`loadChildren` to the feature module, class guards. Match the project.

- **Read params reactively.** A component reused across two ids (`/orders/1` → `/orders/2`) does not
  re-run its constructor; a one-shot read leaves the old data on screen.
- **A lazy route must not be imported statically anywhere.** One top-of-file import puts it back in the
  initial bundle and nothing warns you. Verify with a build and look at the chunk list.
- **Guards decide, they do not load.** Use a resolver only when the screen cannot render without the
  data; otherwise a loading state beats a blocked navigation.
- Measure a preloading strategy in the real browser (`browser-use`) before adding one.

## Module federation, where present

One modern app uses native module federation.

- Shared dependencies must be shared **consistently** — the framework runtime and the UI library
  duplicated across host and remotes produce two injector trees. Read the federation config before
  adding or bumping a shared dependency.
- A failed remote must degrade to an error route, not a blank screen.
- Test the remote standalone and through the host: a provider declared only in the host resolves in the
  composed app and fails in the remote's own tests.
