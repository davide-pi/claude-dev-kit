# Modelling with types — illegal states must not compile

## Discriminated unions

The default shape for anything with more than one state. One literal field is the discriminant, and
every member carries exactly the data that state has — no more.

```ts
type Load<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly data: T }
  | { readonly status: 'failed'; readonly error: string };
```

Why this beats the flat alternative `{ loading: boolean; data?: T; error?: string }`:

| Question | Flat interface | Union |
| --- | --- | --- |
| Can `loading` be true while `data` is set? | yes, and the template will render both | not representable |
| Where is `data` guaranteed? | nowhere — every read needs a check or a `!` | inside the `loaded` branch, by the compiler |
| What happens when a state is added? | nothing; the new combination just appears | every `switch` breaks until handled |

Rules that keep the union honest:

- The discriminant is a **string literal**, on every member, with the same property name.
- Never widen a member's discriminant to `string` — narrowing dies instantly.
- Do not add an optional field to a member "just for one case": that is a new member.
- Prefer a union over a boolean pair. Two booleans are four states, and usually two are nonsense.

## Exhaustiveness

```ts
function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(value)}`);
}
```

Use it as the `default` of every `switch` over a union, and as the `else` of an if-chain. It is the
mechanism that turns "add a state" into a compile error at every consuming site instead of a silent
fallthrough. Without it, adding a union member is a runtime hunt.

Same idea for exhaustive maps: `const label: Record<Status, string>` fails to compile when a status is
added, whereas a lookup function with a fallback silently returns the fallback forever.

## Branded (nominal) types

TypeScript is structural, so `UserId` and `OrderId` as bare `string` aliases are the same type and
interchangeable at every call site. Brand them where a mix-up is plausible — ids, tokens, currency
amounts, already-validated strings:

```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
type UserId = Brand<string, 'UserId'>;
```

Cost: one construction point that does the check and the cast. Benefit: the compiler now separates
"a string" from "a string that has been validated". Brand at the boundary, not deep in the domain.

## Fixed sets: `as const` against `enum`

| Need | Use |
| --- | --- |
| a set of values used only as a type | string-literal union |
| a set that is also data at runtime (render options, iterate, validate) | `as const` object, plus `type X = (typeof OBJ)[keyof typeof OBJ]` |
| interop with a generated client that already declares an enum | the generated enum, unchanged |

Avoid declaring new `enum`s: the numeric form emits a reverse-mapping object and serializes as
numbers, so a persisted or transmitted value silently means something different once the members are
reordered. A string-literal union costs nothing at runtime and survives serialization as itself.

## `readonly` and immutability

| Tool | What it actually does | Where to use it |
| --- | --- | --- |
| `readonly` field | blocks assignment through that reference, at compile time | every DTO, every state object, constructor-injected dependencies |
| `readonly T[]` / `ReadonlyArray<T>` | removes the mutating methods | any array crossing a module or component boundary |
| `Readonly<T>` | shallow — nested objects stay mutable | good for a flat props/state type, misleading for a tree |
| `as const` | literal types plus deep `readonly` for the literal | config objects and fixture data |
| `Object.freeze` | the only runtime guarantee, also shallow | at a boundary where callers are untrusted, or in tests to catch a mutation |

Immutability discipline that matters more than the annotations: **never mutate an object you did not
create**. Both frameworks' change detection depends on reference identity, so a mutation in place is
both a type-system lie and a rendering bug (see `angular` and `react`).

## Generics — what pays for itself

| Pattern | Verdict | Why |
| --- | --- | --- |
| `<T, K extends keyof T>(obj: T, key: K) => T[K]` | keep | the return type depends on the argument; no other tool expresses it |
| `<T>(items: readonly T[], by: (t: T) => string) => Map<string, T[]>` | keep | one parameter drives several positions |
| `<T>(value: T) => void` | drop | `T` is used once — the parameter is `unknown` |
| `<T extends object>(x: T) => string` where the body only calls `JSON.stringify` | drop | decoration |
| a generic added "so it is reusable later" with one call site | drop | write it concretely; generalize on the second caller |
| a generic parameter callers must pass explicitly because inference fails | fix or drop | if inference cannot find it, the signature is wrong |

Constraint discipline: constrain to the smallest shape the body needs (`{ id: string }`, not a whole
domain interface) — the constraint is the documentation of the requirement.

## Function shapes

- Prefer a single object parameter once there are three or more arguments, or two of the same type —
  positional booleans at a call site are unreadable and swap silently.
- Return a discriminated result (`{ ok: true, value } | { ok: false, error }`) rather than `T | null`
  when the caller must know *why* it failed. `T | undefined` is fine when absence is the whole story.
- Overloads are for genuinely different call shapes. If every overload has the same arity and returns
  the same type, a union parameter is shorter and narrows better.
- Never type a callback parameter implicitly: an untyped callback parameter is an implicit `any` in
  disguise in older code, and a wrong inference in new code.
