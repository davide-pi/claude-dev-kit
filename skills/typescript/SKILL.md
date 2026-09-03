---
name: typescript
description: >-
  TypeScript discipline shared by every frontend app here and the base both framework skills sit on:
  the compiler options that actually change outcomes and why strict mode is not negotiable, narrowing
  and control-flow analysis, discriminated unions that make illegal states uncompilable, generics that
  pay for themselves against the ones that obscure, the anti-`any` ladder (`unknown`, type guards,
  assertion functions, schema validation), typing the boundary where untrusted data enters the app,
  `readonly` and immutability, and which type-level tools are worth their maintenance cost. Use when
  writing or reviewing types, tightening a loose `tsconfig`, modelling state, typing an API response
  or a storage payload, or judging whether a cast is acceptable. Framework idioms live in the
  `angular` and `react` skills.
---

# typescript — types that make wrong code fail to compile

## When

- Writing or reviewing types in any app here — both framework skills assume this one.
- `strict` is off, or the compiler is green while the same code throws at runtime.
- Modelling something with mutually exclusive shapes (idle / loading / loaded / error).
- Data crosses into the process: HTTP response, storage, query string, config, message payload.
- An `any`, an `as`, a `!` or a `@ts-ignore` is about to be written — or a review found one.
- A generic, mapped or conditional type is growing past what its next reader can follow.

Not for:

- Framework typing — signals, component props, typed forms, hook generics → `angular`, `react`.
- Web-platform APIs, CSS features and Core Web Vitals → the `modern-web-guidance` plugin.
- Visual and UX design → the `frontend-design` plugin.
- Runtime browser debugging, accessibility auditing, load metrics and heap analysis → the
  `chrome-devtools-mcp` plugin.

## Decide

### The strictness baseline

`strict` is not a style preference: with it off, `null` and `undefined` are assignable to every type,
so the compiler stops answering the only question worth asking. Turn it on, then add these.

| Option | What it costs to leave off | Verdict |
| --- | --- | --- |
| `strict` | nullability, implicit `any`, `this` and call-signature checks all silently disabled | mandatory |
| `noUncheckedIndexedAccess` | `arr[i]` and `record[key]` claim a value that may not exist | mandatory |
| `exactOptionalPropertyTypes` | `{ a?: string }` accepts `{ a: undefined }` — absent and cleared collapse | on; decides PATCH payloads |
| `noImplicitOverride` | a renamed base member turns an override into a new method, silently | on in class-heavy code |
| `noFallthroughCasesInSwitch` | a missing `break` merges two branches | on, free |
| `verbatimModuleSyntax` | type-only imports survive emit and drag side effects in | on |
| `allowJs` without `checkJs` | a whole folder is unchecked and nobody notices | off unless migrating |

**Version-dependent settings — do not guess them.** `target`, `lib`, `module`, `moduleResolution`,
`useDefineForClassFields` and `isolatedModules` are decided by the toolchain, not by taste. Read
`tsconfig.json` **and its whole `extends` chain** (framework base configs set most of them), confirm
the merged result with `npx tsc --showConfig`, and check `package.json` for which compiler and
builder the project actually runs.

### The escape-hatch ladder — stop at the first rung that works

| # | Reach for | When |
| --- | --- | --- |
| 1 | narrowing: `typeof`, `in`, `instanceof`, discriminant check, truthiness | the value is already typed and you need one branch of it |
| 2 | `unknown` plus a type guard `(x): x is T` | the shape is unproven and callers must handle the failure |
| 3 | schema validation at the boundary | the value crossed into the process and must be trustworthy afterwards |
| 4 | assertion function `(x): asserts x is T` | the invariant is real and throwing is the honest report |
| 5 | `satisfies` | inference must be kept while conformance is checked |
| 6 | `as` to a **narrower** type, with a comment naming the invariant | last resort, reviewed |
| — | `any`, `as any`, `!`, `@ts-ignore` | never; if a compiler limitation forces it, `@ts-expect-error` with a reason at least breaks once it is no longer needed |

`as` and `!` are assertions, not checks: they change what the compiler believes, and nothing else.

### Modelling state

```
Do several fields only make sense together, or in some combinations only?
├─ yes → discriminated union on a literal `status` field, one member per legal state,
│         plus an exhaustive `switch` with a `never` default. Optional fields on one flat
│         interface encode illegal states as valid: they compile, then they crash.
└─ no  → one interface, `readonly` fields, no optional field that means "sometimes"

Is the value from a fixed set?
├─ needed at runtime as data (iterate, render, validate) → `as const` object + `keyof typeof`
└─ needed only as a type → string-literal union
   (avoid `enum`: it emits code, and its numeric form is unsound across serialization)

Do two ids of different things share a primitive type?
└─ brand them, or the compiler will let you pass a user id where an order id belongs
```

### Generics that help against generics that obscure

| Shape | Verdict |
| --- | --- |
| relates two positions: `(obj: T, key: K) => T[K]` | helps — this is why generics exist |
| one type parameter used exactly once | delete it — it is `unknown`, or a plain parameter |
| `<T extends object>` whose body never uses `T` | delete it — decoration, not typing |
| conditional or deeply mapped types in application code | usually obscures — write the type out |

## Do

```powershell
npx tsc --noEmit                        # the only verdict that counts; the editor uses another config
npx tsc --showConfig                    # the merged config, after the whole extends chain
npx tsc --noEmit --strict               # price of turning strict on, without editing a file
npx tsc --noEmit -p tsconfig.spec.json  # tests usually have their own project — check it too

# measure the debt before a strictness bump, so progress is visible
(npx tsc --noEmit --strict 2>&1 | Select-String 'error TS' | Measure-Object).Count

# find the escape hatches already in the tree, worst file first
Get-ChildItem -Recurse -Include *.ts,*.tsx src |
  Select-String -Pattern ':\s*any\b', 'as any', '@ts-ignore' |
  Group-Object Path | Sort-Object Count -Descending | Select-Object Count, Name
```

Adopting strict in a loose project: enable it at the root, then fix folder by folder — never a
per-file `@ts-nocheck` amnesty, which hides the count and never gets paid down.

## Traps

1. A field declared required is `undefined` at runtime — the interface described a hope and nothing
   validated the response — parse at the boundary and derive the type from the schema.
2. Narrowing evaporates after an `await` or inside a callback — control-flow analysis cannot prove a
   mutable binding unchanged across it — copy to a `const` first, then narrow.
3. `this.x` narrows, then widens on the next line — narrowing does not stick to mutable members —
   destructure into a local `const`.
4. `catch (e)` used as an `Error` — it is `unknown` — narrow with `instanceof Error` and keep a
   fallback branch for thrown non-errors.
5. A `switch` that was exhaustive silently is not after a union member is added — no `never` default —
   add `default: assertNever(x)` so every call site breaks at compile time.
6. A cast compiles and the shape is still wrong at runtime — `as` asserts, it never checks — replace
   it with a guard or a schema parse.
7. Values do not match across a serialization boundary — a numeric `enum` emits numbers and a reverse
   map — use a string-literal union or an `as const` object.
8. A `readonly` array is mutated anyway — `readonly` is shallow and compile-time only — freeze at the
   boundary, or never hand out the internal reference.
9. Types drift from the backend after a contract change — they were hand-written — generate them from
   the contract and commit the output so the diff is reviewable.
10. Editor green, CI red — a different `tsconfig` or project reference — trust `npx tsc --noEmit` on
    the project the build actually uses.

## References

- `references/compiler-options.md` — a `tsconfig` needs writing, auditing or tightening, or the
  editor and the build disagree.
- `references/type-modelling.md` — modelling state, unions, brands, `readonly`, generics.
- `references/boundaries.md` — data enters from HTTP, storage, config or a message and has to be
  trustworthy afterwards.
- `references/type-level-toolkit.md` — utility, template-literal, mapped and conditional types, and
  the stop rule for the clever ones.
