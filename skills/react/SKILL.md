---
name: react
description: >-
  Use when React code changes or breaks: `*.tsx`, `vite.config.*`, `tailwind.config.*`; a render
  loop, a double fetch, lost state, or a proposed store or query library; "il componente si ri-renderizza".
paths: "**/*.tsx,**/vite.config.*,**/tailwind.config.*"
---

# react — state in the right place, effects almost nowhere

**Contract.** Components, hooks and config written to the placement and effect rules below · never
adds a store, query or form library under its threshold · code English, explanations in the chat language.

## When

Not for: visual design, web-platform APIs, browser debugging and driving the page itself: as in
`angular` (§ When).

House facts: rules `react`, `typescript`.

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

Rule `react` settles it: derive in render, events in handlers, a `key` to reset, an effect only to
sync outside React. Beyond it: measure the DOM before paint → the layout effect, sparingly; fetch on
mount → the resource's hook, or an effect with an `AbortController`.

### Do we add a library yet

None exists in these apps; the thresholds are in rule `react`, plus a small store (not a Redux-style
rewrite) for global client state mutated from many places with derived values. Exactly one is added,
in a pull request of its own that names the threshold; below them a hook plus `useState` is not debt.

### Types — beyond `rules/typescript.md`

| Rule | In practice |
| --- | --- |
| `strict` off somewhere | as in `angular` (§ Decide, Types) |
| the verdict | `npx tsc --noEmit` or `npm run build` — the dev server does not type-check |

## Do

```powershell
npm run dev                    # read package.json scripts first; these are the usual names
npm run build                  # type-check + bundle: the verdict before a push
npx tsc --noEmit
npm test -- --run              # single pass, CI shape; runner flags go after --
npx vite build --mode staging  # a named mode loads the matching .env file
```

Component tests: the runner already in `package.json`, asserting what the user sees, not hook internals.

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
