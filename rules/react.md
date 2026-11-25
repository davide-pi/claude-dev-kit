---
paths: "**/*.tsx,**/*.jsx,**/vite.config.*,**/tailwind.config.*"
---
# React — house facts

- State placement ladder: server-owned data → one owner per resource (a hook called once), as a
  discriminated union; derivable → compute in render; else local `useState` → lift to the nearest
  common parent → the URL when it must survive reload → context for a rarely changing subtree
  (theme, session) → a store only when many unrelated components mutate it.
- No effect for derived state: compute it in render. Reset on a prop change with a `key`.
- `useEffect` only to sync with something outside React, always with cleanup; a fetch carries an
  `AbortController` and aborted results are dropped. Two fetches on mount in development are the
  deliberate strict double-invoke.
- Libraries by threshold: a query library when three or more components share cached server data;
  a form library for dozens of fields with cross-field async validation; a small store for global
  client state mutated from many places. One per pull request naming the threshold; otherwise none.
- Effect that runs every render: an object, array or function literal in its deps. Stale value in a
  callback: updater setter or a ref. Memoize only after measuring.
- List `key` is a stable id, never the index. Split a context that holds unrelated values.
- A controlled input's value is written synchronously, or the cursor jumps.
- Styling is Tailwind utilities; a class built from a string is never scanned: use a lookup map.
- A Vite config change is a build change; the dev server does not type-check: `npm run build` or
  `npx tsc --noEmit` is the verdict. Component tests assert what the user sees, not hook internals.
