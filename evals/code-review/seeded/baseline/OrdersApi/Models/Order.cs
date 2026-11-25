namespace OrdersApi.Models;

public enum OrderStatus { Draft, Confirmed, Shipped, Cancelled }

public sealed class Order
{
    public int Id { get; set; }
    public int CustomerId { get; set; }
    public OrderStatus Status { get; set; }
    public decimal Total { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<OrderLine> Lines { get; set; } = new();
}

public sealed class OrderLine
{
    public string Sku { get; set; } = "";
    public int Quantity { get; set; }
    public decimal UnitPrice { get; set; }
}

public sealed class Customer
{
    public int Id { get; set; }
    public string Email { get; set; } = "";
    public bool IsPremium { get; set; }
}
