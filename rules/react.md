---
paths: "**/*.tsx,**/vite.config.*,**/tailwind.config.*"
---
# React — house facts

- State placement ladder: local `useState` → lift to the nearest common parent → context for a
  subtree → a store only when many unrelated components mutate it.
- No effect for derived state: compute it in render. Reset on a prop change with a `key`.
- `useEffect` only to sync with something outside React, always with cleanup; a fetch carries an
  `AbortController`.
- Libraries by threshold: a query library when three or more components share cached server data;
  a form library for dozens of fields with cross-field async validation; otherwise none.
- Styling is Tailwind utilities; a Vite config change is a build change — rebuild to verify.

Procedure: skill `react`.
