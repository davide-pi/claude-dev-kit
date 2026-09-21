# Where state lives, and how components compose

## Local UI state against server state

They are not two flavours of the same thing. Treating them alike is the mistake that produces most of
the confusing behaviour in these apps.

| | Local UI state | Server state |
| --- | --- | --- |
| owner | the component | the server; the client holds a **copy** |
| truth | whatever the user just did | whatever the last successful response said, which may already be wrong |
| lifetime | the component's | as long as it is useful, then refetch |
| failure modes | none worth naming | loading, error, empty, stale, refetching-while-showing-old |
| duplication | harmless | corrupting: two copies drift, and the user sees whichever component rendered last |
| right shape | `useState` | a discriminated union per resource (idle / loading / loaded / failed), owned once |

Symptoms of the collapse: a `useState` initialized from a fetch in several components; a `loading`
boolean beside a `data` that can be set independently; a "refresh" button that only refreshes one of
the three places showing the same record; an effect that refetches because another component might
have changed something.

The fix is **ownership**, not more effects: one hook per resource, called by one owner component that
passes the data down. If that owner ends up too high in the tree and the prop chain is long, that is
the signal to reach for the query-library threshold in the skill body — not for a context holding
server data, which is the same duplication with extra steps.

## Placing state — in order of preference

1. **Derive it.** Anything computable from props, state or the URL is not state. Compute during
   render. A copied value needs synchronizing, and synchronizing is where bugs live.
2. **Local `useState`.** One component's concern stays in it. Most state is this.
3. **Lift to the nearest common parent.** Two siblings need it: it moves up exactly one level, not to
   the app root.
4. **The URL.** Filters, tabs, pagination, the selected id — anything that should survive a reload or
   be shareable belongs in search params. This is free persistence and free deep-linking, and it is
   under-used here.
5. **Context.** App-wide, rarely changing: theme, session, locale, a feature-flag map. Not a place to
   avoid passing props.
6. **A store.** Only past the threshold in the skill body.

Prop drilling through two levels is fine and readable. Prop drilling through five is a composition
problem (see below), not a reason for context.

## Context, and its cost

Every consumer re-renders when the provider's value identity changes. Consequences:

- Memoize the provider value, or it is a new object on every parent render and the whole subtree
  re-renders.
- **Split by change frequency.** A theme (changes never) and a live counter (changes constantly) in
  one context means everything re-renders with the counter.
- Split value from setters: consumers that only dispatch never need to re-render on value changes.
- Context is not a cache. Server data in a context is one copy with no invalidation, no staleness
  tracking and no request deduplication.
- A context with no default that makes sense should throw from its hook when used outside the
  provider — a silent `undefined` produces a crash three components away.

## Composition — the alternative to configuration

| Instead of | Do |
| --- | --- |
| a component with a growing set of boolean props (`isCompact`, `hasHeader`, `showFooter`) | accept `children` and let the caller compose the parts |
| passing data five levels down to reach one leaf | pass the rendered element down instead — the leaf is created where the data already is |
| a `variant` prop with a `switch` covering unrelated layouts | separate components sharing small pieces |
| a `renderX` prop per slot | named element props, or `children` with sub-components |
| copying a component to change one behaviour | extract the stateful logic into a hook, keep two thin components |

Component boundaries should follow **who owns what state**, not visual boxes. A component that
renders a section but holds none of its own state is usually just markup, and inlining it makes the
owner easier to read.

Container/presentational splitting is worth it exactly when the presentational half is reused or
needs testing without the data; done reflexively it doubles the file count for nothing.

## Reducers

Reach for `useReducer` when several fields change together under named events — a multi-step form, a
small state machine, anything where two `useState` calls must always be updated in the same breath.
The reducer's action union makes the legal transitions explicit and, with a discriminated union, the
compiler enforces exhaustiveness. Keep it local to the component or hook that owns it; a reducer in
context, dispatched from everywhere, is a store built by accident and without any of a store's tools.

## Reviewing state placement

1. Is any state a copy of something derivable? Delete it.
2. Is any server data held in more than one component's state?
3. Does any state sit higher than the components that use it, causing wide re-renders?
4. Is anything in context that changes often, or that is server data?
5. Should any of this be in the URL — would the user expect a reload or a shared link to keep it?
6. Is there an effect whose only job is to keep two pieces of state in agreement?
