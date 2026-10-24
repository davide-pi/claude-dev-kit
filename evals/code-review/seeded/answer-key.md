# Answer key — the change commit built by setup.mjs (anchors are working-tree lines; the password is a planted fake)
| # | Category | Anchor | Defect | Expected owner |
|---|---|---|---|---|
| D1 | logic bug (unit mismatch) | Services/PricingService.cs:14 `order.Total - rate` | subtracts 0.10 instead of 10% | code-reviewer A |
| D2 | off-by-one | Services/PricingService.cs:20 `i <= order.Lines.Count` | IndexOutOfRange | code-reviewer A |
| D3 | sync-over-async | Services/OrderService.cs:47 `.Result` | deadlock/blocking, ct ignored | code-reviewer D / review-performance 4 |
| D4 | null deref | Services/OrderService.cs:48-49 `customer` nullable used unchecked | NRE when customer missing | code-reviewer D |
| D5 | SQL injection | Data/OrderRepository.cs:55 interpolated `status` | status is user input from query | review-security 2 / code-reviewer F |
| D6 | authz gap + IDOR | Controllers/ExportController.cs:8-19 no [Authorize], no ownership check vs criterion 1 | any anonymous caller exports any customer | review-security 3 / code-reviewer F |
| D7 | secret in code | Services/ExportService.cs:10 SftpPassword | committed credential | review-security 4 / code-reviewer F |
| D8 | N+1 | Services/ExportService.cs:31 GetCustomerAsync per order (also redundant: all orders of the same customer) | 1+N queries, N≤500 | review-performance 2 / code-reviewer H |
| D9 | per-item I/O | Services/ExportService.cs:40 File.AppendAllText per row | N file opens | review-performance 2/3 / code-reviewer H |
| D10 | swallowed exception | Services/ExportService.cs:46-48 `catch (Exception) {}` | silent partial CSV, logged as full | code-reviewer D |
| D11 | misleading name / dead code | Services/PricingService.cs:25 IsPremiumCustomer => Id > 0; :27 LegacyTax unused; LegacyVatRate unused | name lies, dead code | code-reviewer G |
| D12 | completeness: Cancelled not excluded | Services/ExportService.cs:24 no status filter vs criterion 2 | criterion 2 unmet | code-reviewer E |
| D13 | logic: discount applies to all (IsPremiumCustomer always true for real customers) vs criterion 3 | PricingService.cs:13/26 | non-premium also discounted | code-reviewer E/A (overlaps D11) |
Decoys (correct): OrderRepository.CountByStatusAsync parameterized; ExportService OCE rethrow filter; Program.cs DI wiring complete; ExportService ListByCustomerAsync(1,500) bounded page (arguably a completeness gap: only first 500 — accept as a legitimate P3 if raised, not an FP).
