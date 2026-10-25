using OrdersApi.Data;
using OrdersApi.Models;
using OrdersApi.Services;

namespace OrdersApi.HiddenTests;

public sealed class FakeRepo : IOrderRepository
{
    private readonly object _gate = new();
    public Dictionary<int, Order> Orders { get; } = new();
    public Dictionary<int, Customer> Customers { get; } = new();
    public TimeSpan ReadDelay { get; set; } = TimeSpan.Zero;
    public List<(int CustomerId, int Page, int PageSize)> ListCalls { get; } = new();

    public async Task<Order?> GetAsync(int id, CancellationToken ct)
    {
        if (ReadDelay > TimeSpan.Zero) await Task.Delay(ReadDelay, ct);
        lock (_gate)
        {
            if (!Orders.TryGetValue(id, out var o)) return null;
            return new Order { Id = o.Id, CustomerId = o.CustomerId, Status = o.Status, Total = o.Total, CreatedAt = o.CreatedAt, Lines = o.Lines };
        }
    }

    public Task<IReadOnlyList<Order>> ListByCustomerAsync(int customerId, int page, int pageSize, CancellationToken ct)
    {
        lock (_gate) ListCalls.Add((customerId, page, pageSize));
        return Task.FromResult<IReadOnlyList<Order>>(new List<Order>());
    }

    public Task<Customer?> GetCustomerAsync(int customerId, CancellationToken ct)
        => Task.FromResult(Customers.TryGetValue(customerId, out var c) ? c : null);

    public Task UpdateTotalAsync(int orderId, decimal total, CancellationToken ct)
    {
        lock (_gate) Orders[orderId].Total = total;
        return Task.CompletedTask;
    }

    public Task SetStatusAsync(int orderId, OrderStatus status, CancellationToken ct)
    {
        lock (_gate) Orders[orderId].Status = status;
        return Task.CompletedTask;
    }

    public Task<bool> TryConfirmAsync(int orderId, CancellationToken ct)
    {
        lock (_gate)
        {
            if (Orders[orderId].Status != OrderStatus.Draft) return Task.FromResult(false);
            Orders[orderId].Status = OrderStatus.Confirmed;
            return Task.FromResult(true);
        }
    }

    public static FakeRepo WithDraft(int id = 1, int customerId = 7, bool customerExists = true)
    {
        var r = new FakeRepo();
        r.Orders[id] = new Order { Id = id, CustomerId = customerId, Status = OrderStatus.Draft, Total = 100m };
        if (customerExists) r.Customers[customerId] = new Customer { Id = customerId, Email = "c@example.invalid" };
        return r;
    }
}

public sealed class FakeNotifier : INotificationService
{
    private int _sent;
    public int Sent => _sent;
    public Task SendOrderConfirmedAsync(string email, Order order, CancellationToken ct)
    {
        Interlocked.Increment(ref _sent);
        return Task.CompletedTask;
    }
}

public sealed class FakeSmtp : ISmtpClient
{
    public Exception? Throw { get; set; }
    public int Calls { get; private set; }
    public Task SendAsync(string to, string subject, string body, CancellationToken ct)
    {
        Calls++;
        return Throw is null ? Task.CompletedTask : Task.FromException(Throw);
    }
}
