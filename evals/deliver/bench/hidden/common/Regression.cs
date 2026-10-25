using Microsoft.Extensions.Logging.Abstractions;
using OrdersApi.Models;
using OrdersApi.Services;
using Xunit;

namespace OrdersApi.HiddenTests;

public class RegressionTests
{
    private static OrderService Service(FakeRepo repo, FakeNotifier n)
        => new(repo, n, NullLogger<OrderService>.Instance);

    [Fact]
    public async Task Confirm_draft_order_confirms_and_notifies_once()
    {
        var repo = FakeRepo.WithDraft();
        var n = new FakeNotifier();
        await Service(repo, n).ConfirmAsync(1, CancellationToken.None);
        Assert.Equal(OrderStatus.Confirmed, repo.Orders[1].Status);
        Assert.Equal(1, n.Sent);
    }

    [Fact]
    public async Task Confirm_unknown_order_throws_not_found()
    {
        await Assert.ThrowsAsync<KeyNotFoundException>(
            () => Service(new FakeRepo(), new FakeNotifier()).ConfirmAsync(99, CancellationToken.None));
    }

    [Fact]
    public async Task List_clamps_page_size_to_100()
    {
        var repo = new FakeRepo();
        await Service(repo, new FakeNotifier()).ListAsync(7, 1, 500, CancellationToken.None);
        Assert.Equal(100, repo.ListCalls[0].PageSize);
    }

    [Fact]
    public async Task Notification_rethrows_when_the_caller_cancelled()
    {
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        var smtp = new FakeSmtp { Throw = new OperationCanceledException(cts.Token) };
        var svc = new SmtpNotificationService(smtp, NullLogger<SmtpNotificationService>.Instance);
        await Assert.ThrowsAnyAsync<OperationCanceledException>(
            () => svc.SendOrderConfirmedAsync("a@example.invalid", new Order { Id = 1 }, cts.Token));
    }
}
