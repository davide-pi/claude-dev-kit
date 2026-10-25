using Microsoft.Extensions.Logging.Abstractions;
using OrdersApi.Models;
using OrdersApi.Services;
using Xunit;

namespace OrdersApi.HiddenTests;

public class OracleDoubleConfirmTests
{
    [Fact]
    public async Task Concurrent_confirms_notify_exactly_once()
    {
        var repo = FakeRepo.WithDraft();
        repo.ReadDelay = TimeSpan.FromMilliseconds(100);
        var n = new FakeNotifier();
        var svc = new OrderService(repo, n, NullLogger<OrderService>.Instance);

        async Task Try()
        {
            try { await svc.ConfirmAsync(1, CancellationToken.None); }
            catch (InvalidOperationException) { }
        }
        await Task.WhenAll(Try(), Try());

        Assert.Equal(1, n.Sent);
        Assert.Equal(OrderStatus.Confirmed, repo.Orders[1].Status);
    }
}
