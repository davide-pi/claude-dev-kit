# Modelling: entities, relationships, and where configuration lives

## One configuration class per entity

Fluent configuration for each entity lives in its own `IEntityTypeConfiguration<T>` class, in the data
or infrastructure project, registered by scanning the assembly from `OnModelCreating`. Attributes are
the wrong default: they put persistence details on a domain type and cannot express most relationships,
composite keys, filters or converters; half in attributes and half fluent means nobody knows where to
look.

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

## Relationships

State both ends, then the keys, then the delete behaviour. Cascade for a genuinely owned child;
restrict for anything a user must handle explicitly; set-null only where the column is nullable and
orphaning is meaningful.

- Many to many: declare the join entity explicitly the moment it carries a payload.
- Self-referencing hierarchy: recursive reads need raw SQL or repeated queries — decide before modelling.
- A relationship crossing an aggregate boundary: a plain identifier, not a navigation.

## Owned types, converters, enums

Value objects (money, an address, a period) are owned types. Owned collections land in their own table
and load with the parent: fine for a small always-needed set, not for a large or independently queried one.

Converters cost: a converted column usually cannot be filtered or ordered efficiently, and a converter
over a collection or JSON blob is invisible to change tracking unless a comparer is supplied — updates
then silently do nothing. Prefer a converter for identity and enum types, real columns for anything you
filter on.

Enums: string when humans read the table or values may be reordered, integer when size dominates; apply
it as a model-wide convention, and never renumber a persisted integer-backed enum.

## Concurrency

Any row two users can edit needs a concurrency token (a row-version column on SQL Server, the
provider's equivalent elsewhere: `providers.md`). Handle the conflict exception deliberately — reload
and re-apply, or return a conflict — never catch and retry blindly.

## Inheritance

Default to one table with a discriminator; move to table-per-subtype only when the nullable columns
become the majority. Changing strategy later is a data migration.

## Query filters

A global query filter is the way to implement soft delete and tenant isolation. It applies to
navigations too (a filtered child silently disappears from an include) and must be ignored explicitly,
greppably, for administrative queries. Never implement tenant isolation by remembering a `where`:
forgotten once is a data leak.

## Keyless entities and read models

Map a view or table-valued function to a keyless entity when the read shape differs from the write
shape. It is read-only and untracked; the view's definition belongs in a migration.

## Modelling for the query, not only for the domain

1. **A DTO per read.** The entity graph is for writes (`querying.md`).
2. **Index what you filter and order by**, in the configuration class, in the same commit as the
   query. Index design itself belongs to `sql-server`.
