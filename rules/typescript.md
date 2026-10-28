---
paths: "**/*.ts,**/*.tsx"
---
# TypeScript — house facts

- `strict` stays on; never loosen `tsconfig` to make an error go away.
- No `any`, `as` cast or non-null `!` without a one-line comment saying why the type system cannot
  know it; prefer `unknown` plus narrowing.
- External data (HTTP, storage, messages) is narrowed once, at the boundary, into a typed shape.
- Alternatives are discriminated unions (a `kind`/`type` field), switched exhaustively.
- Escape-hatch ladder, stop at the first rung that works: narrowing → `unknown` + guard → schema parse
  at the boundary → assertion function → `satisfies` → `as` to a narrower type with a comment. A forced
  suppression is `@ts-expect-error` with a reason, never `@ts-ignore`.
- Read the era from the project (`package.json`, `tsconfig`, sibling files) before writing: match
  its module style, test runner and lint rules.

Procedure (Angular or React project): skill `angular` or `react`.
