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

Non-obvious: a nested `ROLLBACK` aborts the **caller's** transaction (hence the `@@TRANCOUNT` guard and
the savepoint); `XACT_STATE() = -1` means a doomed transaction; bare `THROW` keeps the original error
where `RAISERROR` loses the number; application errors use `THROW <n>` with n ≥ 50000, documented per
procedure.

## Contract rules

- **Schema-qualify everything** (`dbo.X`): unqualified names force a per-user cache lookup and can
  resolve to a different object.
- **Never prefix a procedure with `sp_`**: the engine searches `master` first.
- One result set per procedure, with an explicit column list. Return values are for status only
  (`0` / non-zero); data goes through result sets or `OUTPUT` parameters.
- Parameter types match the columns they filter — an `nvarchar` parameter on a `varchar` column
  removes every seek.
- Table-valued parameters instead of a comma-separated string plus a split function.
- Any procedure whose result feeds pagination needs a total-order `ORDER BY`.

## Dynamic SQL

```sql
DECLARE @sql nvarchar(max) = N'
    SELECT OrderId, Total FROM dbo.Orders WHERE 1 = 1'
  + CASE WHEN @customerId IS NOT NULL THEN N' AND CustomerId = @customerId' ELSE N'' END;

EXEC sys.sp_executesql @sql, N'@customerId int', @customerId = @customerId;
```

- **Values are always parameters**, never concatenated — the injection boundary.
- **Identifiers** chosen at runtime go through `QUOTENAME()` and are validated against `sys.columns` /
  `sys.tables` first.
- `EXEC (@sql)` without `sp_executesql` gets no parameters and no plan reuse — do not use it.

## Permissions and ownership chaining

Grant `EXECUTE` on the procedure and **nothing** on the tables: the ownership chain lets the procedure
touch them while the caller cannot. Dynamic SQL against those tables (or `EXECUTE AS`) breaks the
chain and the caller needs table rights, so the encapsulation is gone.

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

One idempotent file per procedure (`CREATE OR ALTER`) in source control, deployed in dependency order.
Before replacing one, capture the current definition (`SELECT OBJECT_DEFINITION(OBJECT_ID('dbo.Order_Cancel'));`)
so the change is reversible; find what would break with `sys.dm_sql_referencing_entities` — see
`sqlcmd-workflow.md`.
