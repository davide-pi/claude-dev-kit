# Type-level tools — the ones worth knowing, and the stop rule

## Worth knowing cold

| Tool | Use it for | Note |
| --- | --- | --- |
| `Pick`, `Omit` | a view of a model: a form's subset, a list row | `Omit` does not error on a key that does not exist — a rename leaves it silently useless |
| `Partial`, `Required` | PATCH payloads, defaults merging | `Partial` on a state object usually signals a missing discriminated union |
| `Record<K, V>` | exhaustive lookup tables keyed by a union | the exhaustiveness is the point: adding a union member breaks the table |
| `Readonly`, `ReadonlyArray` | boundaries and state | shallow |
| `ReturnType`, `Parameters` | deriving from an existing function instead of restating it | if you reach for it on your own function, consider exporting the type instead |
| `Awaited` | unwrapping a promise result | clearer than a conditional type |
| `NonNullable` | after a filter that removed the nullish values | pair it with the filter's own guard, or it is a lie |
| `keyof`, `typeof`, indexed access `T[K]` | the workhorses; most useful types are these three composed | `(typeof OBJ)[keyof typeof OBJ]` is the `as const` idiom |
| `satisfies` | check an object against a type **while keeping** its literal inference | replaces the annotate-and-lose-literals pattern |
| `import type` | a type-only import that cannot survive emit | mandatory with `verbatimModuleSyntax` |

## Occasionally right

| Tool | Legitimate use | Warning |
| --- | --- | --- |
| template literal types | route paths, event names, css tokens derived from a union | error messages degrade fast once they nest |
| mapped types with key remapping (`as`) | generating a getters type, prefixing keys | one level is readable; two is not |
| conditional types with `infer` | a library boundary that must adapt to the caller's type | in application code, the concrete type is almost always shorter and clearer |
| `declaration merging` / module augmentation | adding a property to a framework interface the app really does extend | put it in one `*.d.ts`, name the reason in a comment; it is global |
| overloads | genuinely different call shapes | implementation signature is not checked against the overloads as strictly as people assume |
| variance annotations (`in`, `out`) | performance on very large unions in a library | not an application concern |

## The clever ones that make a codebase unmaintainable

Recognisable by symptoms rather than by name:

- Recursive conditional types over object trees (`DeepPartial`, `DeepReadonly`, deep path strings).
  They produce error messages nobody can read, they slow the compiler measurably, and they break on
  the first cyclic model.
- Type-level string parsing — splitting a path or a query into a tuple to type the result. The value
  is real in a library; in an app it is a maintenance liability held by one person.
- Types that encode business rules the runtime does not enforce ("only an admin can be assigned
  here"). The rule lives on the server; the type gives false confidence.
- Types so generic that call sites need explicit type arguments to compile. That is the type system
  telling you the abstraction is wrong.
- A `types.ts` full of derived-from-derived aliases, where finding what a field is takes four hops.

### Stop rule

Stop and write the type out concretely when any of these is true:

1. The hover tooltip is unreadable, or the editor shows a truncated type.
2. An error message references a type nobody named — it is an internal step of your own machinery.
3. You cannot explain the type to a reviewer in one sentence.
4. `npx tsc --noEmit` gets noticeably slower after adding it — check with
   `npx tsc --noEmit --extendedDiagnostics` and look at check time and instantiation count.
5. It exists to avoid duplicating fifteen lines. Duplicate the fifteen lines.

The trade is always the same: type-level cleverness buys a guarantee, and it costs everyone who reads
the file afterwards. A library amortizes that cost over many consumers. An application does not.

## Small idioms that come up constantly

- **Exhaustive record instead of a switch** — `const labels: Record<Status, string> = { … }` fails to
  compile when a status is added; a function with a fallback does not.
- **Narrow a filter** — `items.filter((x): x is Loaded => x.status === 'loaded')` keeps the type;
  `filter(x => …)` throws it away.
- **`satisfies` for config** — `const routes = { … } satisfies Record<string, RouteDef>` validates the
  shape while keeping each key literal, so `keyof typeof routes` stays useful.
- **`as const` on a tuple return** — a function returning `[value, setter]` needs `as const`, or it
  widens to an array union and destructuring loses the types.
- **Assertion-free non-null** — replace `x!` with an early `if (!x) return` / `throw`; the compiler
  then knows it for the rest of the function, and the failure is reported rather than hidden.
- **Type a union key map** — `Record<Status, () => void>` for handler dispatch beats a `switch` when
  the branches are one-liners and must stay exhaustive.

## Diagnosing type-level problems

| Symptom | Command / move |
| --- | --- |
| slow type-check | `npx tsc --noEmit --extendedDiagnostics`; look for high instantiation counts |
| unreadable error | assign the value to an intermediate typed `const` to bisect where the mismatch starts |
| "excessively deep" error | a recursive conditional type — remove it, do not raise the limit |
| a type that "should" narrow and does not | check for a mutable binding, a widened discriminant, or a method-syntax callback |
| two packages disagree on the same types | turn `skipLibCheck` off once and read the conflict |

Anything that depends on the compiler release — a new utility type, a changed inference rule — is
verified in the official docs rather than recalled.
