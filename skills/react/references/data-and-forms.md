# Data in, data out — fetching by hand, and forms

No query library exists in any of these apps, so fetching is written by hand: once, as a hook, with all
four states and cancellation — not inlined per component. Two hooks are enough: one for reads, one for
writes.

## The one fetch hook

| Requirement | Why |
| --- | --- |
| a discriminated state (idle / loading / loaded / failed), not independent flags | otherwise loading-and-loaded render at once |
| an `AbortController`, aborted in the effect cleanup | unmounting mid-request and rapid re-triggers leak and race |
| ignoring a response whose request was superseded | out-of-order resolution overwrites fresh data with stale |
| a non-ok response treated as a failure | `fetch` rejects only on network errors |
| validation of the body at this boundary | the response type is a claim, not a check |
| a stable request key (URL plus params) as the effect dependency | an object literal in the dependency array refetches every render |
| a way to refetch on demand | a counter or callback the caller invokes after a mutation |
| idempotence under the development double invoke | it is deliberate; an effect that misbehaves under it is broken anyway |

## Mutations

Mark in-flight and disable the control (never allow a second submit); on a non-ok status read the error
body and surface a typed failure; on success refetch what changed or use the response body; clear
in-flight in `finally`.

- **Refetch beats guessing.** Optimistic updates only for fast, high-frequency, low-stakes actions, and
  with a rollback path.
- Never invalidate by remounting the tree.
- Serialize writes that must not reorder.

## When hand-written stops being right

Named in the skill body: three or more unrelated components needing the same server data with caching
and invalidation. Two components sharing data through one owner is still simpler than a library.

## Forms

Controlled by default; uncontrolled only for a large form of independent fields where per-keystroke
re-rendering is measurable.

| Concern | Approach |
| --- | --- |
| shape | one state object, or a reducer once fields interact; not fifteen `useState` calls |
| validation timing | on blur and on submit, errors only for touched fields |
| validation truth | the same schema used at the API boundary, where the rules overlap |
| server-side errors | field-level errors mapped back onto fields, form-level shown once |
| submit | disable while invalid or in flight; never leave the button disabled after a failure |
| resetting | a `key` on the form remounts it clean |
| numbers, dates | keep the input's string as state, parse at the edge |
| accessibility | auditing in a real browser is `browser-use`'s job |

No form library for a login screen or a filter bar; the threshold is in the skill body.

## Reviewing data code

1. Is there exactly one hook per resource, or is `fetch` inlined in components?
2. Does every request have an abort path, and is a superseded response ignored?
3. Is a non-ok status handled as a failure, with the server's error body read?
4. Is the response validated, or trusted because an interface says so?
5. After a write, is the read refetched — or is local state guessing?
6. Can the submit button be pressed twice?
7. Are loading, error and empty all rendered, or only the happy path?
