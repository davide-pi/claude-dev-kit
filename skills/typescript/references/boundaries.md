# The boundary — where untrusted data becomes typed data

## The rule

An `interface` is a claim about data, never a check on it. Anything that crosses into the process is
`unknown` until something at runtime proves otherwise. That includes, in order of how often it bites:

| Source | Why it lies | Typical failure |
| --- | --- | --- |
| HTTP response | the backend evolved, a field went nullable, an error body has another shape | `undefined` reaching a template or a `.map` |
| `localStorage` / `sessionStorage` | written by an older build of the same app | a shape from three releases ago, parsed as current |
| query string / route params | user-editable | a numeric id that is `"abc"`, an enum value that is not a member |
| runtime config (`window.__CONFIG`, an env JSON) | deployed separately from the code | a missing key that only fails in production |
| message / event payload | another producer, another release cadence | a discriminant value nobody handles |
| a third-party SDK callback | typed optimistically by its own `.d.ts` | `any` leaking into the domain |

Parse at the edge, once, and let the rest of the app work with types it can trust. The alternative —
defensive checks scattered through components — never converges.

## The three mechanisms, in order of strength

| Mechanism | Signature | Gives you | Cost |
| --- | --- | --- | --- |
| type guard | `(x: unknown): x is T` | a boolean the compiler believes; caller must branch | you write and maintain the check; the compiler does not verify it matches `T` |
| assertion function | `(x: unknown): asserts x is T` | narrowing plus a throw at the failure point | same, and it must throw — a guard that returns is silently useless |
| schema validation | `schema.parse(x): T` | the type **derived from** the schema, so they cannot drift | one dependency |

Prefer schema validation wherever a real contract crosses the boundary: the type comes from the
schema (`type Dto = Infer<typeof schema>`), so there is nothing to keep in sync. Hand-written guards
are the right choice for small, local shapes and for narrowing inside already-typed unions.

A hand-written guard must check what it claims: `typeof x === 'object' && x !== null && 'id' in x` is
a guard; `(x): x is User => true` is a cast wearing a costume, and reviewers should reject it.

## Where to put the parse

```
Response arrives
  └─ transport layer (HTTP client wrapper / interceptor / fetch helper)
       ├─ parse into a DTO type            ← the only place `unknown` appears
       ├─ map DTO → domain model           ← rename, widen dates, drop transport noise
       └─ return the domain model, or a typed failure
Components and stores only ever see the domain model.
```

Two boundaries, deliberately: the **DTO** mirrors the wire exactly (including its ugly nullable
fields and string dates), and the **domain model** is what the app wants. Collapsing them means every
backend rename touches every component.

## Failures are part of the contract

- Do not model a failed load as `null`. `null` cannot say whether it was a 404, a validation failure,
  or an aborted request; a discriminated result can.
- A parse failure is a real, expected outcome — log it with the offending payload shape (not the
  payload itself if it carries personal data) and surface a typed error, not a crash.
- HTTP error bodies have their own shape. Type them separately from the success DTO; the framework
  skills cover how each error channel delivers them.
- Never let a parse failure silently produce a default object: a zeroed model rendered as real data is
  worse than an error state.

## Generated clients

When the backend publishes a contract (OpenAPI, a schema file, a shared package), generate the DTOs
and commit the generated file:

- Regeneration produces a reviewable diff — that diff **is** the breaking-change notification.
- Never hand-edit generated output; map it in your own adapter layer instead.
- Generated types still describe the wire, not the domain: keep the mapping step.
- A generated client does not remove the need to validate when the deployed backend can be older than
  the contract you generated from — which, with independently deployed frontends, is normal.

## `unknown`, `any`, and what to do with each

| Situation | Do |
| --- | --- |
| the value's shape is not yet proven | `unknown`, then a guard or a parse |
| a third-party `.d.ts` returns `any` | wrap the call in one adapter function that returns `unknown`, then parse — do not let `any` spread from the import site |
| `catch (e)` | `unknown` by design; narrow with `instanceof Error`, keep a branch for thrown strings and objects |
| `JSON.parse` | returns `any` — assign it to `unknown` immediately, in the same statement |
| a generic constraint you cannot express | `unknown` with a documented guard, never `any` |
| deliberate structural escape in a test fixture | a narrow `as` on the fixture, never in production code |

The practical difference: `unknown` is contagious in the safe direction — it forces the next reader to
prove something — while `any` is contagious in the unsafe direction and disables checking for
everything it touches downstream, including unrelated code paths.

## Reviewing a boundary

Five questions, all answerable from the diff:

1. Where does `unknown` appear? If nowhere, nothing is being validated.
2. Does the declared response type include the nullable fields the backend actually sends?
3. Is there one mapping point per endpoint, or does the DTO shape appear in components?
4. What happens on a parse failure — typed error, or crash, or a silent default?
5. Are dates, decimals and ids still transport primitives (string) deeper in the app than the mapper?
