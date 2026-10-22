using OrdersApi.Data;
using OrdersApi.Models;

namespace OrdersApi.Services;

public sealed class OrderService
{
    private readonly IOrderRepository _repo;
    private readonly INotificationService _notifier;
    private readonly ILogger<OrderService> _log;

    public OrderService(IOrderRepository repo, INotificationService notifier, ILogger<OrderService> log)
    {
        _repo = repo;
        _notifier = notifier;
        _log = log;
    }

    public async Task<Order?> GetAsync(int id, CancellationToken ct) => await _repo.GetAsync(id, ct);

    public async Task<IReadOnlyList<Order>> ListAsync(int customerId, int page, int pageSize, CancellationToken ct)
    {
        if (page < 1) page = 1;
        pageSize = Math.Clamp(pageSize, 1, 100);
        return await _repo.ListByCustomerAsync(customerId, page, pageSize, ct);
    }

    public async Task ConfirmAsync(int id, CancellationToken ct)
    {
        var order = await _repo.GetAsync(id, ct) ?? throw new KeyNotFoundException($"Order {id} not found");
        if (order.Status != OrderStatus.Draft)
            throw new InvalidOperationException($"Order {id} is {order.Status}, cannot confirm");

        order.Status = OrderStatus.Confirmed;
        await _repo.UpdateTotalAsync(id, order.Total, ct);

        var customer = await _repo.GetCustomerAsync(order.CustomerId, ct);
        if (customer is not null)
            await _notifier.SendOrderConfirmedAsync(customer.Email, order, ct);
    }

    public static decimal ComputeTotal(Order order)
    {
        decimal total = 0;
        for (var i = 0; i < order.Lines.Count; i++)
            total += order.Lines[i].Quantity * order.Lines[i].UnitPrice;
        return total;
    }
}
