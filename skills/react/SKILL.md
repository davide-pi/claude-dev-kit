---
name: react
description: >-
  React engineering for the Vite plus Tailwind applications here, all of which keep state in
  components with no store and no data-fetching library. Covers hooks discipline (dependency arrays,
  cleanup, the render-loop traps, and why an effect is usually the wrong tool), component composition
  and where state belongs, the distinction between local UI state and server state that most
  architectural mistakes here collapse, data fetching written by hand and the point at which adding a
  library is justified, the Vite and Tailwind setup as actually configured, what memoization buys and
  what it costs, forms, and component testing with the modern runner. Use when writing, reviewing or
  restructuring React code, or when a component re-renders in a loop, refetches, or loses state.
  Types themselves live in the `typescript` skill.
---

# react — state in the right place, effects almost nowhere

## When

- Writing or reviewing any component, hook, form or fetch in a React app here.
- Deciding where a piece of state lives: component, parent, context, URL, or the server.
- A component re-renders in a loop, fetches twice, races itself, or resets state on navigation.
- Someone proposes a state-management or query library — decide it against the threshold below.
- Setting up or changing the Vite or Tailwind configuration, or writing component tests.

Not for:

- Type modelling, `tsconfig`, DTO validation → `typescript`.
- Web-platform APIs, CSS features and Core Web Vitals → the `modern-web-guidance` plugin.
- Visual and UX design → the `frontend-design` plugin.
- Runtime browser debugging, accessibility auditing, load metrics and heap analysis → the
  `chrome-devtools-mcp` plugin.

## Decide

### Where does this state belong

```
Does the server own the truth?
├─ yes → SERVER STATE. It is a cache, not state: it can be stale, it can fail, it can be
│         refetched, and two components asking for it must not each own a copy.
│         Own it in one place per resource (a hook per resource, called by one owner),
│         pass it down, and model it as a discriminated union — see `typescript`.
└─ no  → is it derivable from props, existing state, or the URL?
          ├─ yes → do not store it. Compute it during render. Copied state goes stale.
          └─ no  → who needs it?
                    ├─ one component            → `useState` in it
                    ├─ a few siblings           → lift to the nearest common parent
                    ├─ it should survive reload / be shareable → the URL (search params)
                    └─ genuinely app-wide, rarely changing (theme, session) → context
```

Conflating server state with UI state is the most common architectural mistake in this codebase: a
`useState` filled from a fetch, in three components, each with its own loading flag, none aware the
data changed. The fix is ownership, not another `useEffect`.

### Do I need an effect

| The goal | Right tool |
| --- | --- |
| transform data for rendering | compute it in the render body |
| respond to a user event | do it in the event handler |
| reset state when a prop changes | a `key` on the component, so React remounts it |
| derive state from props | do not — compute, or lift the source |
| sync with something outside React (subscription, timer, storage, non-React widget) | `useEffect` with cleanup — this is what it is for |
| fetch data on mount | `useEffect` with an `AbortController`, or a hook wrapping it |
| measure the DOM before paint | the layout effect variant, sparingly |

If an effect's only job is to call `setState` from other state, delete it: it renders twice and its
dependency array is a bug waiting to happen.

### Do we add a library yet

No store, no query library and no form library exist in any of these apps. That is a feature until
one of these is true — then add exactly one, for the reason stated:

| Threshold reached | Add |
| --- | --- |
| three or more unrelated components need the same server data, with caching and invalidation | a query library — the thing that is hard to hand-write is cache invalidation, not `fetch` |
| genuinely global client state mutated from many places, with derived values | a small store; not a Redux-style rewrite of the whole app |
| forms with cross-field async validation and dozens of fields | a form library |
| none of the above | nothing. A hook plus `useState` is not technical debt |

Adding a library is a pull request of its own, with the threshold named in the description.

## Do

```powershell
npm install
npm run dev                    # read package.json scripts first; these are the conventional names
npm run build                  # the type-check runs here — a dev server does not type-check
npm run preview                # serve the production build locally
npx tsc --noEmit               # types only, fast
npm test -- --run              # the modern runner, single pass, CI shape
npm test -- --coverage --run
npx vite build --mode staging  # a named mode loads the matching .env file
```

Notes that matter on this machine: PowerShell is the shell, so pass runner flags after `--`; the
frameworks' CLIs are not installed globally, so everything goes through `npm run` or `npx`.

## Traps

1. Infinite render loop — an effect sets state that is in its own dependency array — remove the
   effect and compute the value, or move the write into the event handler.
2. Effect runs on every render — a dependency is an object, array or function literal recreated each
   render — hoist it, or memoize the identity, not the value.
3. Stale value inside a callback or timer — the closure captured an old render's variable — use the
   updater form of the setter, or a ref for a mutable latest value.
4. Two fetches on mount in development — the strict development double-invoke is deliberate — make
   the effect idempotent and abortable rather than suppressing it with a ref.
5. Old response overwrites new — concurrent requests resolve out of order — abort the previous request
   in the cleanup and ignore a response whose request was aborted.
6. State does not reset when the route parameter changes — the component was reused — give it a `key`,
   or derive from the parameter instead of copying it.
7. A list loses focus or input text on reorder — `key` is the index — key by a stable id.
8. Every consumer re-renders on any context change — one context holds unrelated values — split the
   context, or pass the value down explicitly.
9. `useMemo`/`useCallback` everywhere and it is still slow — memoization was applied without measuring
   and its own cost was added — measure first, then memoize what you measured.
10. Input loses a character or the cursor jumps — the value is controlled by state written
    asynchronously — keep the controlled value synchronous, do the async work after.
11. A Tailwind class built from a string at runtime does not apply — the scanner never saw it — use
    complete class names behind a lookup map.
12. Types are green locally and the build fails — the dev server does not type-check — run
    `npx tsc --noEmit` or the build before pushing.

## References

- `references/hooks-and-effects.md` — dependency arrays, cleanup, refs, custom hooks, and the cost of
  memoization.
- `references/state-and-composition.md` — where state lives, local against server state, composition
  and context.
- `references/data-and-forms.md` — fetching without a library, mutations, and forms.
- `references/vite-tailwind-setup.md` — the build and styling setup as configured here, env modes,
  aliases, code splitting.
- `references/testing.md` — component testing with the modern runner: what to assert, what to fake.
