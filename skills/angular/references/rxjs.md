# RxJS discipline

## The operators that actually matter

| Operator | Use for | Note |
| --- | --- | --- |
| `map`, `filter` | shaping | if the pipe is only these, a signal `computed` may be the better answer |
| `switchMap` | a new inner request cancels the previous one | the default for search, typeahead, route-param-driven loads |
| `concatMap` | writes that must keep order | queues; a slow first write delays the rest, which is usually correct |
| `exhaustMap` | ignore new triggers while one is in flight | submit buttons, double-click protection |
| `mergeMap` | genuinely order-independent parallel work | with `concurrent` set; unbounded `mergeMap` is a load generator |
| `combineLatest` | several streams that must all have emitted | emits per source change — debounce or `distinctUntilChanged` downstream |
| `withLatestFrom` | one trigger stream, other values as context | the trigger decides when; the others do not fire it |
| `startWith`, `scan` | initial value, accumulation | `scan` is a reducer in a stream — fine for a small local state machine |
| `debounceTime`, `distinctUntilChanged` | user input | almost always together; without `distinctUntilChanged` a re-emitted identical value refetches |
| `shareReplay({ bufferSize: 1, refCount: true })` | share one execution among subscribers | **always** with `refCount: true`, or the source is kept alive forever |
| `catchError` | error handling | placement is the whole game — see below |
| `finalize` | teardown regardless of outcome | for spinners, so they clear on error too |
| `takeUntil`, `takeUntilDestroyed`, `take(1)` | bounded subscription lifetime | `takeUntil` must be the **last** operator in the pipe |

Operators worth avoiding: `toPromise`-style conversions that lose cancellation, `delay` used to fix a
race (the race is the bug), and any nested `subscribe`.

## Subscription lifetime and leaks

```
Can the template consume it?
├─ yes → `async` pipe (module era) or a signal conversion (modern era). Done — no leak possible.
└─ no  → does it complete on its own (a single HTTP call, `take(1)`)?
          ├─ yes → subscribing is safe, but the callback may still touch a destroyed component
          └─ no  → bound it: `takeUntilDestroyed` (modern) or a destroy subject with `takeUntil`
```

Leak symptoms and their causes:

| Symptom | Cause |
| --- | --- |
| a handler runs N times after N navigations | one un-torn-down subscription per component instance |
| memory grows across route changes | same, usually on a long-lived subject or a router event stream |
| an HTTP call fires after the user left the page | an unbounded stream feeding a `switchMap` |
| a state update hits a destroyed component | a completing stream whose callback assumes the component is alive |

A service must never subscribe on the caller's behalf. It returns the observable; the component or
effect decides when and how long it runs.

## Cold, hot, and duplicate requests

The HTTP client returns a **cold** observable: each subscription performs the request. Two `async`
pipes on the same observable means two requests. Fixes, in order of preference: consume it once and
share the result through the template, `shareReplay` with reference counting, or store the result.

A `Subject` is hot and has no memory — a late subscriber gets nothing. `BehaviorSubject` has the
current value and is the usual choice for a small service-held state in module-era code; in modern
code that is exactly what a signal replaces.

## Error handling

- `catchError` **inside** the inner observable of a `switchMap`/`mergeMap` keeps the outer stream
  alive. `catchError` on the outer pipe kills the whole stream after the first failure, which is how
  a store effect stops responding for the rest of the session.
- Returning `of(null)` from `catchError` converts a failure into a value the caller cannot detect.
  Return a typed failure — a discriminated result, or a failure action — so the caller must handle it.
- `retry` with a backoff is right for idempotent reads and wrong for writes. Bound the attempt count
  and exclude client-error statuses, or a rejected request retries three times before failing anyway.
- Let the error carry its context. Rethrowing a bare `Error('failed')` from an interceptor deletes the
  status and the body the UI needed.

## Signal interop — when a signal is the right answer instead

| Situation | Answer |
| --- | --- |
| synchronous derived state read in a template | signal `computed` — an observable pipeline here is ceremony |
| local UI state (a toggle, a selected row) | signal; a `BehaviorSubject` for this is a habit, not a requirement |
| anything asynchronous with cancellation, retry, debounce or several sources | RxJS, then convert the result to a signal at the component edge |
| a stream whose latest value is all the template needs | convert to a signal with an initial value, and drop the `async` pipe |
| a signal that must feed an RxJS pipeline (e.g. a filter driving a search) | convert the signal to an observable, then `switchMap` |

Conversion helpers live in the RxJS interop entry point of `@angular/core`; check what this project's
`@angular/core` exports before using them, and note that converting an observable without an initial
value requires either a `requireSync` source or an explicit initial value.

Rule of thumb: **state is a signal, events are a stream.** Most confusion in this codebase comes from
modelling state as a stream (a `BehaviorSubject` chain) or events as state (a signal written from
three places).
