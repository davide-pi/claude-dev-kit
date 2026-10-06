---
name: react
description: >-
  Use whenever React code is written, reviewed or debugged in the Vite and Tailwind apps — a
  component re-renders in a loop, fetches twice or loses state, a store or query library is proposed,
  the Vite or Tailwind config changes, or an `any` or a cast is in question.
---

# react — state in the right place, effects almost nowhere

## When

- Writing or reviewing any component, hook, form or fetch in a React app here.
- Deciding where a piece of state lives: component, parent, context, URL, or the server.
- A component re-renders in a loop, fetches twice, races itself, or resets state on navigation.
- Someone proposes a state-management or query library — decide it against the threshold below.
- Setting up or changing the Vite or Tailwind configuration.
- A type, a `tsconfig` option, an `any`, an `as` or a `!` is being written or reviewed.

Not for:

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
│         pass it down, and model it as a discriminated union (house rules below).
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

### Types — the house rules, in five lines

| Rule | In practice |
| --- | --- |
| `strict` is not negotiable | with it off, `null` fits every type and the compiler stops answering. New code compiles under it; where it is off, price it with `npx tsc --noEmit --strict` and fix folder by folder — never a `@ts-nocheck` amnesty |
| Climb the escape-hatch ladder, stop at the first rung that works | narrowing → `unknown` + type guard → schema parse at the boundary → assertion function → `satisfies` → `as` to a narrower type with a comment. Never `any`, `as any`, `!` or `@ts-ignore`; a forced one is `@ts-expect-error` with a reason |
| Data crossing in is unproven | an HTTP response, storage or a query string is parsed at the boundary, not described by an interface and trusted; contract types are generated, not hand-copied |
| Exclusive states are a union | a discriminated union on `status` with an exhaustive `switch` and a `never` default — not optional fields on one flat interface |
| The compiler on the build's project is the verdict | `npx tsc --noEmit` (and `--showConfig` for the merged `extends` chain); editor green proves nothing. No CLI is installed globally — always `npx` |

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

- `references/state-and-composition.md` — where state lives, local against server state, composition
  and context.
- `references/data-and-forms.md` — fetching without a library, mutations, and forms.
- `references/vite-tailwind-setup.md` — the build and styling setup as configured here, env modes,
  aliases, code splitting.

Component tests: match the runner already in `package.json` and assert what the user sees, not hook
internals; the decision of what deserves a test is in `dotnet-testing`'s strategy reference.
