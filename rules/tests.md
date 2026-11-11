---
paths: "**/*Tests*/**/*.cs,**/*.spec.ts,**/*.test.ts,**/*.test.tsx,**/*.test.mjs"
---
# Tests — house convention

- Every test you add or rewrite is Given/When/Then; it wins over the siblings' naming. A test you
  don't otherwise touch keeps its name.
- Name: C# `Given_<State>_When_<Action>_Then_<Outcome>`; TS and JS title
  `given <state>, when <action>, then <outcome>`.
- Body: three blocks, opened by `// Given`, `// When`, `// Then`.
