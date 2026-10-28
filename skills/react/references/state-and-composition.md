# Where state lives, and how components compose

## Local UI state against server state

Treating them alike produces most of the confusing behaviour in these apps. Server state is a **copy**
the client holds; its right shape is a discriminated union per resource (idle / loading / loaded /
failed), owned once. Duplicating it corrupts: two copies drift.

Symptoms of the collapse: a `useState` initialized from a fetch in several components; a `loading`
boolean beside a `data` that can be set independently; a "refresh" button that refreshes one of three
places showing the same record; an effect that refetches because another component might have changed
something.

The fix is **ownership**, not more effects: one hook per resource, called by one owner component that
passes the data down. If the owner ends up too high and the prop chain is long, that is the signal for
the query-library threshold in the skill body — not for a context holding server data, which is the same
duplication with extra steps.

## Placing state — in order of preference

1. **Derive it.** Anything computable from props, state or the URL is not state.
2. **Local `useState`.**
3. **Lift to the nearest common parent**, exactly one level, not to the app root.
4. **The URL.** Filters, tabs, pagination, the selected id: anything that should survive a reload or be
   shareable belongs in search params. Under-used here.
5. **Context.** App-wide, rarely changing: theme, session, locale, a feature-flag map. Not a way to
   avoid passing props.
6. **A store.** Only past the threshold in the skill body.

Prop drilling through two levels is fine; through five is a composition problem.

## Context, and its cost

- Memoize the provider value, or the whole subtree re-renders on every parent render.
- **Split by change frequency**, and split value from setters.
- Context is not a cache: server data in a context has no invalidation, staleness tracking or dedup.
- A context with no sensible default should throw from its hook outside the provider.

## Composition — the alternative to configuration

| Instead of | Do |
| --- | --- |
| a growing set of boolean props (`isCompact`, `hasHeader`) | accept `children` and let the caller compose |
| passing data five levels down to one leaf | pass the rendered element down |
| a `variant` prop with a `switch` over unrelated layouts | separate components sharing small pieces |
| copying a component to change one behaviour | extract the stateful logic into a hook, keep two thin components |

Component boundaries follow **who owns what state**, not visual boxes. Container/presentational
splitting only when the presentational half is reused or needs testing without the data.

## Reducers

`useReducer` when several fields change together under named events. Keep it local to the component
or hook that owns it; a reducer in context dispatched from everywhere is a store built by accident.

## Reviewing state placement

1. Is any state a copy of something derivable? Delete it.
2. Is any server data held in more than one component's state?
3. Does any state sit higher than the components that use it, causing wide re-renders?
4. Is anything in context that changes often, or that is server data?
5. Should any of this be in the URL?
6. Is there an effect whose only job is to keep two pieces of state in agreement?
