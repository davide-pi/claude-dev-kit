using Microsoft.Extensions.Logging.Abstractions;
using OrdersApi.Services;
using Xunit;

namespace OrdersApi.HiddenTests;

public class OracleFirstPageTests
{
    [Theory]
    [InlineData(1, 20)]
    [InlineData(3, 5)]
    public async Task List_hands_the_one_based_page_to_the_repository(int page, int pageSize)
    {
        var repo = new FakeRepo();
        var svc = new OrderService(repo, new FakeNotifier(), NullLogger<OrderService>.Instance);
        await svc.ListAsync(7, page, pageSize, CancellationToken.None);
        Assert.Equal((7, page, pageSize), repo.ListCalls[0]);
    }
}
