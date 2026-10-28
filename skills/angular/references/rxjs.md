# RxJS discipline

## Operator choices that decide behaviour

| Operator | Use for | Note |
| --- | --- | --- |
| `switchMap` | a new inner request cancels the previous one | default for search, typeahead, route-param-driven loads |
| `concatMap` | writes that must keep order | a slow first write delays the rest, usually correct |
| `exhaustMap` | ignore new triggers while one is in flight | submit buttons |
| `mergeMap` | genuinely order-independent parallel work | set `concurrent`; unbounded `mergeMap` is a load generator |
| `combineLatest` | several streams that must all have emitted | emits per source change — debounce or `distinctUntilChanged` downstream |
| `debounceTime` | user input | pair with `distinctUntilChanged` or a re-emitted identical value refetches |
| `shareReplay({ bufferSize: 1, refCount: true })` | share one execution | **always** `refCount: true`, or the source is kept alive forever |
| `finalize` | teardown regardless of outcome | for spinners, so they clear on error too |
| `takeUntil` | bounded lifetime | must be the **last** operator in the pipe |

If a pipe is only `map`/`filter`, a signal `computed` may be better. Avoid `delay` used to fix a race
(the race is the bug) and any nested `subscribe`.

## Subscription lifetime

The template consumes it (`async` pipe in module era, signal conversion in modern) — no leak possible.
Otherwise a completing source (one HTTP call, `take(1)`) is safe to subscribe but the callback may touch
a destroyed component; a non-completing one is bounded with `takeUntilDestroyed` (modern) or a destroy
subject with `takeUntil`. A service never subscribes on the caller's behalf.

Symptoms: a handler running N times after N navigations, or memory growing across route changes = one
un-torn-down subscription per component instance.

## Cold, hot, and duplicate requests

The HTTP client returns a **cold** observable: two `async` pipes on the same observable is two
requests. Fix: consume once and share through the template, `shareReplay` with reference counting, or
store the result. `BehaviorSubject` for small service-held state is module-era; in modern code a signal
replaces it.

## Error handling

- `catchError` **inside** the inner observable of a `switchMap`/`mergeMap` keeps the outer stream
  alive; on the outer pipe it kills the whole stream after the first failure (how a store effect stops
  responding for the session).
- Returning `of(null)` from `catchError` turns a failure into a value the caller cannot detect: return a
  typed failure (discriminated result or failure action).
- `retry` with backoff for idempotent reads only; bound the attempts and exclude client-error statuses.
- Rethrowing a bare `Error('failed')` from an interceptor deletes the status and body the UI needed.

## Signals or streams

**State is a signal, events are a stream.** Most confusion here comes from modelling state as a stream
(a `BehaviorSubject` chain) or events as state (a signal written from three places).

| Situation | Answer |
| --- | --- |
| synchronous derived state, local UI state | signal / `computed` |
| asynchronous with cancellation, retry, debounce or several sources | RxJS, then convert the result to a signal at the component edge |
| a stream whose latest value is all the template needs | convert with an initial value, drop the `async` pipe |
| a signal feeding an RxJS pipeline (a filter driving a search) | convert the signal to an observable, then `switchMap` |

Check what this project's `@angular/core` exports before using the interop helpers; an observable
without an initial value needs a `requireSync` source or an explicit initial value.
