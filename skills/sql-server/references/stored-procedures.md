# Stored procedures — the database as the application

One workspace has no application code at all: the procedures *are* the system. There, a procedure is
reviewed like a public API — its signature, its contract, its error behaviour and its permissions
are part of the interface.

## The standard header

```sql
CREATE OR ALTER PROCEDURE dbo.Order_Cancel
    @OrderId   int,
    @Reason    nvarchar(200),
    @CancelledBy int
AS
BEGIN
    SET NOCOUNT ON;          -- no "N rows affected" chatter in the client
    SET XACT_ABORT ON;       -- any error aborts the transaction instead of leaving it open

    DECLARE @outer int = @@TRANCOUNT;      -- caller may already be in a transaction
    IF @outer = 0 BEGIN TRANSACTION;
    ELSE SAVE TRANSACTION Order_Cancel;    -- nested: a savepoint, not a second transaction

    BEGIN TRY
        UPDATE dbo.Orders
           SET Status = 'Cancelled', CancelledAt = SYSUTCDATETIME(), CancelledBy = @CancelledBy
         WHERE OrderId = @OrderId AND Status = 'Open';

        IF @@ROWCOUNT = 0
            THROW 50010, 'Order not found or not cancellable.', 1;

        INSERT dbo.OrderAudit (OrderId, Action, Reason, At)
        VALUES (@OrderId, 'Cancel', @Reason, SYSUTCDATETIME());

        IF @outer = 0 COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        IF @outer = 0 AND XACT_STATE() <> 0 ROLLBACK TRANSACTION;
        ELSE IF @outer > 0 AND XACT_STATE() = 1 ROLLBACK TRANSACTION Order_Cancel;
        THROW;               -- rethrow with the original number, message and severity
    END CATCH
END
```

Why each line is there:

| Element                        | Reason                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| `CREATE OR ALTER`              | the script is idempotent, so it can be deployed repeatedly and diffed in git |
| `SET NOCOUNT ON`               | avoids extra result sets that confuse clients and ORMs                  |
| `SET XACT_ABORT ON`            | without it, some errors leave the transaction open and the connection poisoned |
| `@@TRANCOUNT` guard            | a nested `ROLLBACK` would abort the **caller's** transaction            |
| `SAVE TRANSACTION`             | the only way to undo just this procedure's work when nested             |
| `XACT_STATE()`                 | `-1` means the transaction is doomed and cannot be committed or partially rolled back |
| `THROW` with no arguments      | preserves the original error; `RAISERROR` re-wraps and loses the number |
| `THROW <n>, ...` with n ≥ 50000 | application errors get their own numeric range, documented per procedure |
| Explicit column list on `INSERT` | survives a column being added to the table                            |

## Contract rules

- **Schema-qualify everything** (`dbo.X`, not `X`): unqualified names force a per-user cache lookup
  and can resolve to a different object.
- **Never prefix a procedure with `sp_`**: the engine searches `master` first.
- One result set per procedure, with an explicit column list. Two result sets is a hidden contract
  the caller cannot discover.
- Return values are for status only (`0` / non-zero); real data goes through result sets or `OUTPUT`
  parameters.
- Declare parameter types to match the columns they filter — an `nvarchar` parameter on a `varchar`
  column removes every seek in the procedure.
- Table-valued parameters instead of a comma-separated string plus a split function.
- Deterministic ordering: any procedure whose result feeds pagination needs a total-order `ORDER BY`.

## Dynamic SQL

```sql
DECLARE @sql nvarchar(max) = N'
    SELECT OrderId, Total FROM dbo.Orders WHERE 1 = 1'
  + CASE WHEN @customerId IS NOT NULL THEN N' AND CustomerId = @customerId' ELSE N'' END
  + CASE WHEN @from       IS NOT NULL THEN N' AND CreatedAt >= @from'       ELSE N'' END;

EXEC sys.sp_executesql @sql,
     N'@customerId int, @from datetime2',
     @customerId = @customerId, @from = @from;
```

- **Values are always parameters**, never concatenated — that is the injection boundary.
- **Identifiers** (a table or column name chosen at runtime) cannot be parameters: pass them through
  `QUOTENAME()` and validate them against `sys.columns` / `sys.tables` first.
- `EXEC (@sql)` without `sp_executesql` gets no parameters and no plan reuse — do not use it.
- Dynamic SQL runs under the caller's permissions unless the procedure uses `EXECUTE AS`, which
  breaks the ownership chain that made the procedure safe in the first place.

## Permissions and ownership chaining

Grant `EXECUTE` on the procedure and **nothing** on the tables. Because the procedure and the tables
share an owner, the ownership chain lets the procedure read and write them while the caller cannot
touch them directly. That property is lost the moment the procedure uses dynamic SQL against those
tables — then the caller needs table rights, and the encapsulation is gone.

```sql
GRANT EXECUTE ON SCHEMA::dbo TO [app_role];   -- role, never a user
```

## Reviewing a procedure

| Check                                                        | Failure mode if missing                        |
| ------------------------------------------------------------ | ---------------------------------------------- |
| `SET NOCOUNT ON` and `SET XACT_ABORT ON`                     | phantom result sets, orphaned transactions      |
| Every `BEGIN TRANSACTION` matched under both TRY and CATCH   | a connection left holding locks                 |
| `@@ROWCOUNT` checked after a conditional write               | silent no-op instead of an error                |
| No external dependency inside the transaction                | locks held for the duration of someone else's outage |
| No cursor without a written justification                    | row-by-row execution                           |
| No `SELECT *`                                                | breaks when a column is added; widens plans     |
| Concurrency intent stated: `UPDLOCK` on read-then-write      | lost updates and self-deadlocks                 |
| Deleted or updated set is bounded                            | lock escalation to a table lock                 |
| Errors use the reserved application range and are documented | callers cannot distinguish failure causes       |
| Idempotency for anything a client may retry                  | duplicate side effects on a retried timeout     |

## Deployment

Procedures live in source control as one idempotent file each (`CREATE OR ALTER`), deployed in
dependency order. Before replacing one, capture the current definition so the change is reversible:
`SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.Order_Cancel'));`. Find what would break with
`sys.dm_sql_referencing_entities('dbo.Orders', 'OBJECT')` — see `sqlcmd-workflow.md`.
