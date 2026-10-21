---
name: react
description: >-
  Use when React code changes or breaks: `*.tsx`, `vite.config.*`, `tailwind.config.*`; a render
  loop, a double fetch, lost state, or a proposed store or query library.
---

# react — state in the right place, effects almost nowhere

**Contract.** Components, hooks and config written to the placement and effect rules below · never
adds a store, query or form library under its threshold · code English, explanations Italian.

## When

- Writing, reviewing or debugging a component, hook, form or fetch in the Vite + Tailwind apps.
- Deciding where state lives: component, parent, URL, context or the server.
- A render loop, a double fetch, a race, state lost or not reset on navigation.
- A library is proposed, or the Vite or Tailwind configuration changes.

Not for: visual design, web-platform APIs and browser debugging → the `frontend-design`,
`modern-web-guidance` and `chrome-devtools-mcp` plugins.

Facts also in `rules/react.md` and `rules/typescript.md`, loaded when such a file is touched.

## Decide

### Where does this state belong

```
Does the server own the truth?
├─ yes → SERVER STATE: a cache that can be stale, fail or refetch. One owner per resource
│         (a hook per resource, called once), passed down, modelled as a discriminated union.
└─ no  → derivable from props, existing state or the URL?
          ├─ yes → do not store it: compute it during render. Copied state goes stale.
          └─ no  → who needs it?
                    ├─ one component                       → `useState` in it
                    ├─ a few siblings                      → lift to the nearest common parent
                    ├─ must survive reload / be shareable  → the URL (search params)
                    └─ app-wide, rarely changing (theme, session) → context
```

The common failure here: a `useState` filled from a fetch in three components, three loading flags,
none aware the data changed. The fix is one owner, not another `useEffect`.

### Do I need an effect

| The goal | Tool |
| --- | --- |
| transform data for rendering | compute in the render body |
| respond to a user event | the event handler |
| reset state when a prop changes | a `key` on the component |
| sync with something outside React (subscription, timer, storage, widget) | `useEffect` with cleanup |
| fetch on mount | `useEffect` with an `AbortController`, or the resource's hook |
| measure the DOM before paint | the layout effect, sparingly |

An effect whose only job is `setState` from other state is deleted: it renders twice and its
dependency array is a latent loop.

### Do we add a library yet

None exists in these apps; that holds until a threshold is reached, then exactly one is added, in a
pull request of its own that names the threshold.

| Threshold | Add |
| --- | --- |
| three or more unrelated components share server data needing cache and invalidation | a query library |
| global client state mutated from many places, with derived values | a small store, not a Redux-style rewrite |
| forms with dozens of fields and cross-field async validation | a form library |
| none of the above | nothing — a hook plus `useState` is not debt |

### Types — beyond `rules/typescript.md`

| Rule | In practice |
| --- | --- |
| escape-hatch ladder, stop at the first rung that works | narrowing → `unknown` + guard → schema parse at the boundary → assertion function → `satisfies` → `as` to a narrower type with a comment; a forced suppression is `@ts-expect-error` with a reason, never `@ts-ignore` |
| `strict` off somewhere | price it with `npx tsc --noEmit --strict`, fix folder by folder; never a `@ts-nocheck` amnesty |
| the verdict | `npx tsc --noEmit` or `npm run build` — the dev server does not type-check |

## Do

```powershell
npm run dev                    # read package.json scripts first; these are the usual names
npm run build                  # type-check + bundle: the verdict before a push
npx tsc --noEmit
npm test -- --run              # single pass, CI shape; runner flags go after --
npx vite build --mode staging  # a named mode loads the matching .env file
```

Component tests: the runner already in `package.json`, asserting what the user sees, not hook
internals; what deserves a test is `dotnet-testing`'s strategy reference.

## Traps

1. Effect runs every render → an object, array or function literal in its deps → hoist or memoize it.
2. Stale value in a callback or timer → the closure captured an old render → updater setter, or a ref.
3. Two fetches on mount in development → the deliberate strict double-invoke → idempotent, abortable.
4. Old response overwrites new → out-of-order resolution → abort in the cleanup, drop aborted results.
5. A list loses focus or input on reorder → `key` is the index → a stable id.
6. Every consumer re-renders on any context change → one context holds unrelated values → split it.
7. `useMemo`/`useCallback` everywhere, still slow → memoized without measuring → measure first.
8. Cursor jumps or a character is lost → the controlled value is written async → keep it synchronous.
9. A Tailwind class built from a string does not apply → the scanner never saw it → a lookup map.

## References

- `references/state-and-composition.md` — local against server state, composition, context.
- `references/data-and-forms.md` — the one fetch hook, mutations, forms without a library.
- `references/vite-tailwind-setup.md` — build and styling as configured, env modes, aliases, splitting.
