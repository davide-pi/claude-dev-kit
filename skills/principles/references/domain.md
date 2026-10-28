# Domain — where rules and invariants live (rungs 3 and 4)

Rung 2 still wins: a service whose entities are plain data and whose rules sit in handlers keeps
that shape. This file decides where a new rule goes, and when a rule scattered across callers has
become a defect.

## Where a rule lives

| The rule | Owner |
| --- | --- |
| an invariant of one entity (a total that equals its lines, a state that allows only some moves) | the entity: a method that changes the state checks it; no public setter bypasses it |
| a rule spanning several entities of one aggregate | the aggregate root, in one method |
| a rule spanning aggregates or services | the handler or service that orchestrates them; never copied into each entity |
| a validation of input shape (required, length, format) | the edge, once (`architecture.md` § Who owns new code) |
| a calculation with no state (a price, a tax, a date rule) | a pure function next to its data, testable without a database |

## Rich or anemic

| Signal | Verdict |
| --- | --- |
| the neighbours' entities are plain data and the rules live in handlers | follow them (rung 2) |
| the same invariant checked in two callers | a `Noticed` row; the change adds the second copy → one shared method instead |
| the same invariant in three or more callers, or two copies that already diverged | move it to the entity or one domain method, when the change touches one of them |
| an entity with public setters that a caller can leave invalid | the change adds a method that changes the state and checks it; it does not rewrite the entity |
| behaviour added to an entity that needs a repository, the bus or the clock | wrong owner: the entity takes the value, the handler fetches it |

## Aggregates and consistency boundaries

| Question | Answer |
| --- | --- |
| what must change together in one transaction | one aggregate; keep it as small as the invariant allows |
| another aggregate must react | an event after the commit, handled idempotently; never one transaction across both |
| another service's data is needed | its id and a copy of the fields you read, refreshed by its events; never its entity type |
| two writers race on the same aggregate | optimistic concurrency (a row version) on the root; a retry or a clean conflict error |

## Not a finding

- A plain-data entity in a module that uses that shape everywhere (rung 2).
- A rule in a handler that no other caller needs.
- DDD vocabulary absent: the test is where the rule lives, never what it is called.
