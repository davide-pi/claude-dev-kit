---
paths: "**/*.ts,**/*.tsx"
---
# TypeScript — house facts

- `strict` stays on; never loosen `tsconfig` to make an error go away.
- No `any`, `as` cast or non-null `!` without a one-line comment saying why the type system cannot
  know it; prefer `unknown` plus narrowing.
- External data (HTTP, storage, messages) is narrowed once, at the boundary, into a typed shape.
- Alternatives are discriminated unions (a `kind`/`type` field), switched exhaustively.
- Read the era from the project (`package.json`, `tsconfig`, sibling files) before writing: match
  its module style, test runner and lint rules.

Procedure: skill `angular` or `react`, whichever the project is.
