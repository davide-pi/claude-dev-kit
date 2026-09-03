# JSONB — modelling, querying, and when it is the wrong answer

## `jsonb`, not `json`

`json` stores the text verbatim: no operator support worth having, no indexing, whitespace and key
order preserved, duplicate keys kept. `jsonb` is parsed and stored in a binary form: it is the only
one to use. The only reason to pick `json` is needing the original text byte for byte, which is
almost never a requirement.

## When it is right

| Shape                                                              | Verdict                                    |
| ------------------------------------------------------------------ | ------------------------------------------ |
| A payload received from outside, stored for audit or replay        | JSONB — it is a document, treat it as one  |
| Caller-defined custom fields, different per tenant                 | JSONB with an expression or GIN index      |
| A sparse bag of optional attributes, read as a whole               | JSONB                                      |
| A settings blob read whole and written whole                       | JSONB                                      |
| Cached projection of another system's response                     | JSONB — this is the read-cache use case    |

## When it is wrong

| Signal                                                              | Do this instead                            |
| ------------------------------------------------------------------- | ------------------------------------------ |
| You filter, join or aggregate on the same key in every query        | promote that key to a column                |
| It needs a foreign key, a `NOT NULL`, a `CHECK` or a unique constraint | columns — JSONB enforces nothing        |
| The shape is known and stable and shared by all rows                | columns; a JSONB "schema" is a schema nobody validates |
| Field-by-field updates, many per second, on a large document        | columns, or a child table — every update rewrites the whole value, and a TOASTed value rewrites its out-of-line chunks too |
| It has grown into a nested structure queried by path                | a child table; a join beats a path expression |
| Sorting or paginating on a value inside it                          | a generated column plus a B-tree index      |
| Numeric aggregation over a key across millions of rows              | a column, or a materialised projection      |

The honest test: **if a query needs it in a `WHERE`, a `JOIN` or an `ORDER BY`, it wants to be a
column.** JSONB is for what the database only stores, not for what the database reasons about.

## Operators

| Operator / function              | Meaning                                                     |
| -------------------------------- | ----------------------------------------------------------- |
| `data -> 'k'`                    | the value at key `k`, **as jsonb**                           |
| `data ->> 'k'`                   | the value at key `k`, **as text** — this is what you compare |
| `data #> '{a,b}'`                | value at a path, as jsonb; `#>>` as text                     |
| `data @> '{"k": 1}'`             | containment — the indexable equality predicate               |
| `data ? 'k'`                     | key exists                                                   |
| `data ?& array['a','b']`         | all these keys exist; `?\|` for any                          |
| `data @? '$.items[*] ? (@ > 5)'` | JSON path predicate                                          |
| `jsonb_set(data, '{k}', '"v"')`  | write one key, returning a new value                         |
| `data - 'k'`, `data #- '{a,b}'`  | remove a key / a path                                        |
| `data \|\| '{"k":1}'`            | shallow merge                                                |
| `jsonb_array_elements(data->'items')` | expand an array into rows, for joining                  |
| `jsonb_each(data)`               | expand an object into key/value rows                         |
| `jsonb_populate_record` / `to_jsonb` | convert between a row type and jsonb                    |

Two things that bite: `->` returns jsonb, so `data->'k' = 'x'` compares against the **jsonb** string
`"x"` and needs quoting — use `->>` and compare as text. And a missing key yields `NULL`, not an
error, so a typo in the key name is a silently empty result.

## Indexing

```sql
-- Containment and key-existence queries over the whole document
CREATE INDEX ix_events_data_gin ON events USING gin (data);

-- Smaller and faster, but only supports @>, @? and @@ (no key-existence operators)
CREATE INDEX ix_events_data_gin ON events USING gin (data jsonb_path_ops);

-- One key, compared as text: a plain B-tree on the expression is cheaper than GIN
CREATE INDEX ix_events_tenant ON events ((data ->> 'tenantId'));

-- A key that behaves like a column: make it one, and index it normally
ALTER TABLE events ADD COLUMN tenant_id text GENERATED ALWAYS AS (data ->> 'tenantId') STORED;
CREATE INDEX ix_events_tenant_id ON events (tenant_id);
```

| Query shape                       | Index                                        |
| --------------------------------- | -------------------------------------------- |
| `data @> '{"status":"open"}'`     | GIN (either opclass)                          |
| `data ? 'legacyFlag'`             | GIN, default opclass only                     |
| `data ->> 'tenantId' = $1`        | B-tree on the expression                      |
| `(data ->> 'total')::numeric > $1` | B-tree on the cast expression, or a generated column |
| ordering by a JSONB value          | generated column + B-tree                     |
| full text inside the document      | GIN over `to_tsvector(...)`                   |

A generated stored column is the pragmatic answer whenever a key is queried like a column: it keeps
the document intact, gives the planner real statistics, and can carry a constraint.

GIN indexes are expensive to maintain. On a write-heavy table, prefer expression indexes on the two
or three keys that are actually queried over one GIN index over everything.

## Validation

JSONB validates that the text is JSON and nothing more. Where a shape matters, enforce it:

```sql
ALTER TABLE events ADD CONSTRAINT events_data_shape
  CHECK (data ? 'tenantId' AND jsonb_typeof(data -> 'items') = 'array');
```

That constraint is cheap and catches the class of bug that JSONB otherwise pushes into production —
but it is still weaker than a column, and it is not a substitute for one.

## From .NET

The client maps `jsonb` to a POCO, to `JsonDocument`, or to `string`. Mapping to a POCO is
convenient and hides the cost: the whole document is deserialised on read and re-serialised on
write, so a partial update through the ORM rewrites the entire value. When only one key changes, do
it in SQL with `jsonb_set` instead of round-tripping the document. See `npgsql-dotnet.md`.
