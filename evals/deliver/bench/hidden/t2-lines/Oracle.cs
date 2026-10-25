using OrdersApi.Models;
using OrdersApi.Services;
using Xunit;

namespace OrdersApi.HiddenTests;

public class OracleLinesTests
{
    [Fact]
    public void Total_includes_every_line()
    {
        var o = new Order();
        o.Lines.Add(new OrderLine { Sku = "A", Quantity = 2, UnitPrice = 10m });
        o.Lines.Add(new OrderLine { Sku = "B", Quantity = 1, UnitPrice = 5m });
        o.Lines.Add(new OrderLine { Sku = "C", Quantity = 3, UnitPrice = 1m });
        Assert.Equal(28m, OrderService.ComputeTotal(o));
    }

    [Fact]
    public void Single_line_order_is_not_free()
    {
        var o = new Order();
        o.Lines.Add(new OrderLine { Sku = "A", Quantity = 1, UnitPrice = 9m });
        Assert.Equal(9m, OrderService.ComputeTotal(o));
    }
}
