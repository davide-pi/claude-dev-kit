# Evidence pack — the card, the briefs, the pack, the synthesis

Every collector gets the same card, one role section and the pack format. The pack carries facts; an
agent's own reading section stays, labelled as its reading. The hypotheses belong to the synthesis.

## Card

```text
## Case
Symptom: <the user's words, verbatim>
Window: <from → to, UTC> (user said: <as given, with zone>)
Ids: <correlation / trace / business ids, or none>
Environment: <local | staging | prod> · services: <names, or unknown>
Roots: backend <path | none> · frontend <path | none>
Context: <work item title + state, Slack summary, commits and deploys in the window — one line each>
Ruled out: <what the user or the pre-flight already excluded, or none>
```

## Role sections

**ops-analyst**
```text
## Your part
Logs (and Grafana metrics when reachable) for <services> in <env> over the window. Filter by each id first,
then errors without the id. Find: the first error, its repeats, the requests before it. Read only.
```

**db-analyst** (state reads, in the `/db` output shape)
```text
## Your part
On <target>, read the current state of <entities> by <ids>: status, timestamps, related rows (children,
outbox, audit). SELECT only; at most 10 statements; no plan analysis. Use your `/db` output shape for
each statement. db-ro.ps1 exit 3 or 4 → stop and put the target and the grant list in Blocked.
```

**investigator, backend**
```text
## Your part
Root: <backend root>. `locate` the code that owns <behaviour>; `trace` it when it crosses the bus. List
the conditions under which that code produces the symptom (validation, branch, exception path).
```

**investigator, frontend**
```text
## Your part
Root: <frontend root>. From <screen or action> walk route → component → HTTP call → state. Report the
exact endpoint (verb + URL) and how the UI handles its error. The backend is not yours: stop at the URL.
```

## Pack — the format every brief ends with

```text
First your native output, every section kept as your instructions define it. Then, after it, exactly
these sections, ≤ 40 lines in all:
## Ran          <the count of commands, queries or greps, then verbatim the ones that decided something, with host/root>
## Timeline     <ts with offset · source · fact>, one per line, oldest first
## Not found    <what returned empty: the query or filter and window used>
## Blocked      <an input you lacked (target, label, root, a db-ro grant list), with candidates>, or none
```

## Synthesis — the shape shown to the user

```text
## Timeline
<ts UTC> · <source> · <fact>   (merged, oldest first)
## Gaps
<Not found and Blocked from every pack; what is still unknown>
## Path
<UI → API → bus → DB, each hop file:line or log line; unconfirmed hops marked>
## Hypotheses
1. <cause> — predicts: <what must also be true> — probe: <the command that decides it>
2. …
## Next
<the probe to run first, and who runs it>
```

At chat `it`: Timeline=Cronologia, Gaps=Lacune, Path=Percorso, Hypotheses=Ipotesi, Next=Prossimo passo.
