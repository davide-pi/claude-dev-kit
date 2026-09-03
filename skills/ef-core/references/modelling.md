# Modelling: entities, relationships, and where configuration lives

## One configuration class per entity

Put the fluent configuration for each entity in its own `IEntityTypeConfiguration<T>` class, in the
data or infrastructure project, and register them all by scanning the assembly from
`OnModelCreating`. The payoff: a context that stays a few lines long, a predictable file to open for
any entity, and configuration that lives next to the persistence concern instead of in the domain.

Attributes are the wrong default here. They put persistence details on a domain type, they cannot
express most relationships, composite keys, filters or converters, and half a model in attributes plus
half in fluent configuration means nobody knows where to look.

## What to configure explicitly, even when a convention would guess right

| Configure | Because the default is |
|---|---|
| String maximum length | unbounded — a `max` column, unindexable, and a wide row |
| Decimal precision and scale | provider-dependent, and silently rounds money |
| Required versus optional | inferred from nullability, which drifts when nullable reference types are off |
| Delete behaviour on every relationship | cascade in places you did not intend, which deletes data |
| Index on every foreign key you filter or join on | not created for you in every case |
| A unique index behind any "must be unique" rule | nothing — the rule is unenforced under concurrency |
| Table and column names, if the database is pre-existing | pluralization conventions that will not match |

Explicit configuration is also documentation: the configuration class is the fastest way to answer
"what does this table actually look like" without opening the database.

## Relationships

State both ends, then the keys, then the delete behaviour. Guessing is where cascade-delete accidents
come from.

| Shape | Note |
|---|---|
| One to many | the standard; declare the collection, the reference, and the foreign key |
| Many to many | the join entity can be implicit; declare it explicitly the moment it carries a payload (a date, a role, an order) |
| One to one | the dependent side must be told which end holds the foreign key |
| Self-referencing hierarchy | works, but recursive reads need raw SQL or repeated queries — decide before modelling it |
| A relationship crossing an aggregate boundary | model it as a plain identifier, not a navigation — it keeps the aggregates independent and prevents accidental loading |

Delete behaviour, chosen deliberately: cascade for a genuinely owned child; restrict for anything a
user must handle explicitly; set-null only where the column is nullable and orphaning is meaningful. A
cascade path that reaches an aggregate you did not intend is a data-loss bug waiting for one delete.

## Owned types and value objects

Model a value object (money, an address, a period) as an owned type: it has no identity of its own,
lives in its parent's table by default, and cannot be queried independently. That is the right shape
for a value object and it keeps the domain expressive without a second table.

Owned collections land in their own table and are loaded with the parent. Fine for a small, always
needed set; not a substitute for a real entity when the collection is large or queried on its own.

## Value converters

Use a converter to keep a domain type in the model while storing a primitive: a strongly typed id, an
enum stored as a short string, a date-only value, a set stored as a delimited string. Two costs to
know before reaching for one:

- a converted column usually cannot be filtered or ordered efficiently, because the provider compares
  the stored form, and any function over it is untranslatable;
- a converter over a collection or a JSON blob makes the property invisible to change tracking unless
  a comparer is supplied — updates then silently do nothing.

Prefer a converter for identity and enum types; prefer real columns for anything you filter on.

## Enums

Store the string, not the integer, when humans will read the table or when values may be reordered;
store the integer when space and index size dominate. Whichever you choose, apply it as a convention
for the whole model, and never renumber an integer-backed enum after it has been persisted.

## Concurrency

Any row two users can edit needs a concurrency token: a row-version column on SQL Server, or the
provider's equivalent elsewhere (`providers.md`). Without it, the last save silently overwrites the
other, and the loss is undetectable after the fact.

With a token configured, a conflicting save throws a concurrency exception. Handle it deliberately —
reload and re-apply, or return a conflict to the caller — but do not catch and retry blindly, which
reproduces the overwrite you were preventing.

## Inheritance

| Strategy | Result | Use when |
|---|---|---|
| One table with a discriminator | one wide table, nullable columns for subtype fields | subtypes differ by a few fields |
| A table per subtype, joined | normalized, joins on read | subtypes differ substantially |
| A table per concrete type | no joins, duplicated columns | subtypes are queried separately and rarely polymorphically |

Default to the discriminator, and only move when the nullable columns become the majority. Changing
strategy later is a data migration, not a configuration change.

## Query filters

A global query filter is the correct way to implement soft delete and tenant isolation: it cannot be
forgotten, because it applies to every query on the entity. Two consequences to plan for: it applies
to navigations too, so a filtered child silently disappears from an include; and it must be ignored
explicitly for administrative queries, which is a deliberate, greppable call.

Never implement tenant isolation by remembering to add a `where` clause. It will be forgotten once,
and once is a data leak.

## Keyless entities and read models

Map a view or a table-valued function to a keyless entity when the read shape is genuinely different
from the write shape: a report, a denormalized list, an aggregate. It is read-only, never tracked, and
the view is the contract — which means the view's definition belongs in a migration so it is versioned
with the code.

## Modelling for the query, not only for the domain

Two habits pay for themselves in this estate:

1. **A DTO per read.** If a screen needs six fields, the query projects six fields. The entity graph
   is for writes; reads do not need it (`querying.md`).
2. **Index what you filter and order by.** The model is where the index is declared, so the moment a
   query is written, the index goes into the configuration class in the same commit. Index design
   itself belongs to `sql-server`.
