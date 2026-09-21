# Data in, data out — fetching by hand, and forms

No query library exists in any of these apps, so fetching is written by hand. That is fine, provided
it is written once, as a hook, with all four states and cancellation — not inlined per component.

## The one fetch hook

What it must handle, all of it, or it will be re-implemented badly in the next component:

| Requirement | Why |
| --- | --- |
| a discriminated state (idle / loading / loaded / failed), not three independent flags | otherwise loading-and-loaded render at once; see `typescript` |
| an `AbortController`, aborted in the effect cleanup | a component unmounting mid-request, and rapid re-triggers, both leak and race |
| ignoring a response whose request was superseded | out-of-order resolution overwrites fresh data with stale data |
| a non-ok response treated as a failure | `fetch` rejects only on network errors — a server error status resolves normally, and the JSON parse then throws something unhelpful |
| validation of the body at this boundary | the response type is a claim, not a check — `typescript`, `references/boundaries.md` |
| a stable request key (URL plus params) as the effect dependency | an object literal in the dependency array refetches on every render |
| a way to refetch on demand | a counter or a callback the caller can invoke after a mutation |
| idempotence under the development double invoke | it is deliberate; an effect that misbehaves under it is broken anyway |

Two hooks are enough for these apps: one for reads (the above) and one for writes (below). Everything
else is a wrapper around them.

## Mutations

```
User submits
  ├─ mark in-flight, disable the control (never allow a second submit)
  ├─ send; on a non-ok status, read the error body and surface a typed failure
  ├─ on success → refetch what changed, or update the local copy from the response body
  └─ finally → clear in-flight, even on failure
```

- **Refetch beats guessing.** Updating local state to what you *think* the server now holds drifts
  from reality; asking again is one request and always right. Optimistic updates are worth it only for
  fast, high-frequency, low-stakes actions, and only with a rollback path.
- Never invalidate by remounting the tree — it flashes and loses unrelated state.
- Serialize writes that must not reorder; ignore extra triggers while one is in flight.
- A mutation returning the updated entity lets you skip the refetch honestly — use the response, not
  your own reconstruction.

## When hand-written stops being right

Named in the skill body: three or more unrelated components needing the same server data with caching
and invalidation. The hard parts are cache keys, deduplication, invalidation and background
refresh — not `fetch`. Two components sharing data through one owner is still simpler than a library.

## Forms

Controlled by default: state in React, value flows down, changes flow up. Uncontrolled (reading from
the DOM on submit, or via a ref) is the right answer for a large form of independent fields where
per-keystroke re-rendering is measurable — and only then.

| Concern | Approach |
| --- | --- |
| shape | one state object for the whole form, or a reducer once fields interact; not fifteen `useState` calls |
| validation timing | validate on blur and on submit, show errors only for touched fields — validating on every keystroke shouts at the user mid-word |
| the source of validation truth | the same schema used to validate the API boundary, where the rules overlap — one definition, two uses |
| server-side errors | field-level errors mapped back onto fields, form-level errors shown once; never a bare "something went wrong" when the server said which field |
| submit | disable while invalid or in flight; the handler is `async`, and it never leaves the button disabled after a failure |
| resetting | a `key` on the form remounts it clean — cheaper and more reliable than resetting every field |
| numbers, dates | keep the input's own string as the state, parse at the edge; parsing on each keystroke fights the user (a half-typed number is not a number) |
| files | uncontrolled by necessity; read from the input's ref on submit |
| accessibility | label association, error announcement and focus management matter, and auditing them is the `chrome-devtools-mcp` plugin's job |

Do not reach for a form library for a login screen or a filter bar. Reach for it when cross-field
async validation and dozens of fields arrive together — the threshold in the skill body.

## Reviewing data code

1. Is there exactly one hook per resource, or is `fetch` inlined in components?
2. Does every request have an abort path, and is a superseded response ignored?
3. Is a non-ok status handled as a failure, with the server's error body read?
4. Is the response validated, or trusted because an interface says so?
5. After a write, is the read refetched — or is local state guessing?
6. Can the submit button be pressed twice?
7. Are loading, error and empty all rendered, or only the happy path?
