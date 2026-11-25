# Baseline checklist — the cases criteria usually forget

Idea: `shape-it`'s baseline checklist.

Run it once, when a task's `criteria` are written. An area that applies gets a Given/When/Then
criterion with its proof; an area that does not is skipped silently. No criterion is added "just in case".

| Area | Ask |
| --- | --- |
| Session and auth expiry | What happens when the session or token expires between opening the screen and submitting? |
| Authorization | Which roles or tenants may do this, and what does each other one receive? |
| Uniqueness and duplicates | What happens on a double submit, a client retry or a repeated message? |
| Lists | What shows with zero, one and many rows, and how do paging, sort and filter behave at each? |
| Input limits and validation | Which values are too long, too large, empty or malformed, and what error does the caller read? |
| Uploads and files | What happens with a file over the size limit, of the wrong type, or missing? |
| Concurrency | What happens when two writers hit the same record, or one saves data already stale? |
| Time | Which time zone is stored and shown, what happens across a DST change, and which culture formats dates and numbers? |
| Dependency failure | What state remains when a dependency times out or fails after a partial write? |
| Data migration and rollback | How do existing rows migrate, and how is the change undone if it must be? |
| Observability | Which log line or metric identifies the error path, without leaking secrets? |
| CI | Does the criterion's verify command run in the pipeline, not only locally? |
