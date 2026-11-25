using System.Data;
using Dapper;
using OrdersApi.Models;

namespace OrdersApi.Data;

public interface IOrderRepository
{
    Task<Order?> GetAsync(int id, CancellationToken ct);
    Task<IReadOnlyList<Order>> ListByCustomerAsync(int customerId, int page, int pageSize, CancellationToken ct);
    Task<Customer?> GetCustomerAsync(int customerId, CancellationToken ct);
    Task UpdateTotalAsync(int orderId, decimal total, CancellationToken ct);
}

public sealed class OrderRepository : IOrderRepository
{
    private readonly IDbConnection _db;

    public OrderRepository(IDbConnection db) => _db = db;

    public async Task<Order?> GetAsync(int id, CancellationToken ct)
    {
        const string sql = "SELECT Id, CustomerId, Status, Total, CreatedAt FROM Orders WHERE Id = @id";
        return await _db.QuerySingleOrDefaultAsync<Order>(new CommandDefinition(sql, new { id }, cancellationToken: ct));
    }

    public async Task<IReadOnlyList<Order>> ListByCustomerAsync(int customerId, int page, int pageSize, CancellationToken ct)
    {
        // page is 1-based
        const string sql = @"SELECT Id, CustomerId, Status, Total, CreatedAt FROM Orders
                             WHERE CustomerId = @customerId
                             ORDER BY CreatedAt DESC
                             OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY";
        var rows = await _db.QueryAsync<Order>(new CommandDefinition(sql,
            new { customerId, offset = (page - 1) * pageSize, pageSize }, cancellationToken: ct));
        return rows.ToList();
    }

    public async Task<Customer?> GetCustomerAsync(int customerId, CancellationToken ct)
    {
        const string sql = "SELECT Id, Email, IsPremium FROM Customers WHERE Id = @customerId";
        return await _db.QuerySingleOrDefaultAsync<Customer>(new CommandDefinition(sql, new { customerId }, cancellationToken: ct));
    }

    public async Task UpdateTotalAsync(int orderId, decimal total, CancellationToken ct)
    {
        const string sql = "UPDATE Orders SET Total = @total WHERE Id = @orderId";
        await _db.ExecuteAsync(new CommandDefinition(sql, new { orderId, total }, cancellationToken: ct));
    }
}
