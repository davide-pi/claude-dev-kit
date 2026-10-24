using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using OrdersApi.Models;
using OrdersApi.Services;

namespace OrdersApi.Controllers;

[ApiController]
[Route("api/orders")]
[Authorize]
public sealed class OrdersController : ControllerBase
{
    private readonly OrderService _orders;

    public OrdersController(OrderService orders) => _orders = orders;

    private int CurrentCustomerId => int.Parse(User.FindFirst("customer_id")!.Value);

    [HttpGet("{id:int}")]
    public async Task<ActionResult<Order>> Get(int id, CancellationToken ct)
    {
        var order = await _orders.GetAsync(id, ct);
        if (order is null) return NotFound();
        if (order.CustomerId != CurrentCustomerId) return Forbid();
        return order;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<Order>>> List([FromQuery] int page = 1, [FromQuery] int pageSize = 20, CancellationToken ct = default)
        => Ok(await _orders.ListAsync(CurrentCustomerId, page, pageSize, ct));

    [HttpPost("{id:int}/confirm")]
    public async Task<IActionResult> Confirm(int id, CancellationToken ct)
    {
        var order = await _orders.GetAsync(id, ct);
        if (order is null) return NotFound();
        if (order.CustomerId != CurrentCustomerId) return Forbid();
        await _orders.ConfirmAsync(id, ct);
        return NoContent();
    }
}
