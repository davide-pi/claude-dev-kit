---
paths: "**/*Tests*/**/*.cs,**/*.spec.ts,**/*.test.ts,**/*.test.tsx,**/*.test.mjs"
---
# Tests — house convention

- Every test you add or rewrite is Given/When/Then; it wins over the siblings' naming. A test you
  don't otherwise touch keeps its name.
- Name: C# `Given_<State>_When_<Action>_Then_<Outcome>`; TS and JS title
  `given <state>, when <action>, then <outcome>`.
- Body: three blocks in that order, each opened by its comment inside the test body:
  `// Given` (arrange), `// When` (the one action), `// Then` (assert).
  ```ts
  it('given an empty cart, when adding an item, then the total is its price', () => {
    // Given
    const cart = new Cart();
    // When
    cart.add(item(5));
    // Then
    expect(cart.total).toBe(5);
  });
  ```
- A behaviour change is test-first: write the test, see it fail for the right reason, then write the
  code. Only a change no test can observe (rename, move, config, generated code, docs) skips it, and
  the report names which exception applied.
