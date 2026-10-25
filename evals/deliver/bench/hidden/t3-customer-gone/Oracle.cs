using Microsoft.Extensions.Logging.Abstractions;
using OrdersApi.Models;
using OrdersApi.Services;
using Xunit;

namespace OrdersApi.HiddenTests;

public class OracleCustomerGoneTests
{
    [Fact]
    public async Task Confirm_without_customer_still_confirms_and_sends_nothing()
    {
        var repo = FakeRepo.WithDraft(customerExists: false);
        var n = new FakeNotifier();
        var svc = new OrderService(repo, n, NullLogger<OrderService>.Instance);
        await svc.ConfirmAsync(1, CancellationToken.None);
        Assert.Equal(OrderStatus.Confirmed, repo.Orders[1].Status);
        Assert.Equal(0, n.Sent);
    }
}
