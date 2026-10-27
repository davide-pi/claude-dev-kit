# Design — abstractions and patterns (rungs 4 and 5)

A pattern enters only when its force is present in the code today. A force foreseen ("we might add
another provider") is not a force: the owner states it, or it does not count.

## Abstractions

| Tension | Winner | Unless |
| --- | --- | --- |
| an interface with one implementation | the concrete class | the test seam the stack skill names, or a second implementation inside the scope |
| inheritance against composition | composition | the framework hands you a base class to extend |
| a static helper against an injected service | static when pure (no I/O, no clock, no config) | it does I/O or a test must replace it → injected |
| a generic type or method | the concrete type | a second concrete use exists today |
| a boolean parameter that switches behaviour | two methods, or an enum | one private caller, and the call reads clearly |
| a primitive against a value type (`Email`, `Money`) | the primitive | the same validation or unit conversion appears in two places |
| an in-process event against a direct call | the direct call | several independent reactions, each owned elsewhere |
| configuration against code | code | the value differs per environment or changes without a release |

## Patterns: the force that justifies each

| Pattern | Present force that justifies it | Cheaper default otherwise |
| --- | --- | --- |
| Strategy | three or more variants picked at runtime, and the list grows | a `switch` on the variant |
| Factory | construction needs a decision or resources the caller must not know | `new`, or the DI container |
| Builder | many optional parts, or an object assembled in steps (test data counts) | a constructor or an object initializer |
| Decorator | the same concern around several implementations of an existing interface | the concern inline in the one place |
| Adapter | a third-party or legacy API crosses into your code | none: wrap every external SDK you do not own |
| Repository | the neighbours already have one (rung 2) | the `DbContext` or query the neighbours use directly |
| Mediator / command bus | the library is already in the solution (rung 1) | a direct call to the handler |
| Observer / events | several subscribers that the publisher must not know | a direct call |
| State machine | an entity with four or more states and guarded transitions, bugs on the guards | an enum and a guard method |
| Template method | — | composition: pass the varying step as a delegate or strategy |
| Singleton by hand | — | a singleton DI lifetime |
| Specification | the same filter composed in several queries | a named query method |

## Cohesion signals

| Signal | Move, inside the scope only |
| --- | --- |
| a class whose methods use disjoint sets of fields | split by the field sets |
| a method that changes for two unrelated reasons | split along the reasons |
| a change that always edits the same three files together | they belong closer: one module or one type |
| a "Manager", "Helper" or "Utils" growing with each feature | name the real responsibility; move each part to its owner |
