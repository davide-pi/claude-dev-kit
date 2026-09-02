# Hooks discipline, effects, and the cost of memoization

## The rules that are not style

- Hooks run in the same order on every render: never inside a condition, a loop or an early return.
  This is why the lint rule exists, and why disabling it always ends in a crash that looks unrelated.
- The render body must be pure: no fetching, no mutation of anything outside it, no DOM writes. A
  component is a function from props and state to elements, called more often than you think.
- Never mutate state. Same array, same object, same render output — React compares by reference.
- A setter call does not update the variable you are holding; it schedules the next render. Reading
  it back on the next line reads the old value.
- Use the updater form (`setX(prev => …)`) whenever the next value depends on the previous one. The
  direct form captures the value from the render that created the closure.

## Dependency arrays

The array is not a tuning knob — it declares what the effect reads. Getting it "wrong on purpose" is
how stale-closure bugs get built.

| Symptom | Cause | Fix |
| --- | --- | --- |
| effect runs every render | a dependency identity changes each render (object/array/function literal, or a `new` anything) | hoist the value out, memoize the identity, or depend on the primitive fields instead of the object |
| effect never re-runs when it should | the array is `[]` but the body reads props or state | list them, then fix whatever that reveals |
| infinite loop | the effect sets state listed in its own array | delete the effect and compute the value, or write in the event handler |
| stale value in an interval or subscription callback | the closure is from an old render | updater form, or a ref holding the latest value, refreshed in an effect |
| lint wants a dependency you "know" is stable | it usually is not, or it is a function that should be defined inside the effect | move the function inside the effect, or memoize it |

Move a function that only the effect uses **inside** the effect. That removes the dependency instead
of memoizing it, and it is the single most effective simplification here.

## Cleanup

Every effect that starts something must stop it, in the returned cleanup:

| Started | Cleanup |
| --- | --- |
| `addEventListener` | `removeEventListener` with the same function reference |
| `setInterval` / `setTimeout` | clear it |
| a fetch | `AbortController.abort()`, and ignore the abort rejection |
| a subscription (storage, media query, an external client) | unsubscribe |
| a mutable "is current" flag | set it false — the simplest guard against a late resolution |

Cleanup also runs between re-runs of the same effect, not just on unmount. The development-mode
double invoke exists to surface a missing cleanup: an effect that breaks under it is broken in
production too, just less visibly. Make it idempotent; do not suppress the second run with a ref.

## Refs

`useRef` is for values that must survive renders **without** causing one: a DOM node, a timer id, a
"has submitted" flag, the latest value of something read inside a callback. Reading or writing a ref
never re-renders, which is exactly why rendered data must not live in one — a ref holding display
data produces a UI that updates one interaction late.

## Custom hooks

- Extract a hook when the same *stateful logic* repeats, not to shorten a component. A hook that is
  called once and only groups lines is indirection with no payoff.
- A hook returns values and stable callbacks. Returning a new object literal every render forces
  every memoized consumer to re-render — memoize the returned object if consumers depend on it.
- Name what it does, not what it wraps: `useOrderFilters`, not `useCustomState`.
- Hooks compose: a data hook plus a form hook beats one hook that does both and is testable in one
  configuration only.

## Memoization — what it buys and what it costs

| Tool | Buys | Costs |
| --- | --- | --- |
| `useMemo` | skips an expensive computation when inputs are unchanged | the comparison, the retained value, and a dependency array that can go stale |
| `useCallback` | a stable function identity | only useful if the consumer is memoized or it is an effect dependency — otherwise pure overhead |
| a memoized component | skips re-rendering a subtree | one prop with a new identity per render defeats it entirely, silently |

Order of operations, always:

1. **Measure.** Use the profiler and the `chrome-devtools-mcp` plugin for runtime measurement — not
   intuition, and not a memo added "to be safe".
2. **Fix the structure first.** Most slowness here is a re-render of a large subtree caused by state
   sitting too high, a context holding unrelated values, or an unstable prop — all cheaper to fix than
   to memoize around.
3. **Reduce the work.** Fewer items rendered (pagination, windowing), less computed per item, cheaper
   keys.
4. **Then memoize**, at the boundary you measured, and re-measure.

Where memoization is worth it without much thought: a genuinely expensive pure computation (parsing,
sorting or grouping a large list), and a stable callback passed to a memoized child in a long list.
Where it is not: primitives, small objects, anything cheaper than the comparison, and a callback
passed to a plain child.

A compiler-driven memoization step exists in the ecosystem. Check `package.json` and the Vite config
before assuming this project has it; where it is enabled, hand-written memoization mostly becomes
noise, and the manual layer should be removed rather than kept "just in case".
