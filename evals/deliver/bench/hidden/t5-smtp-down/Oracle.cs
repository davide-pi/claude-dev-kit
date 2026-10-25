using Microsoft.Extensions.Logging.Abstractions;
using OrdersApi.Models;
using OrdersApi.Services;
using Xunit;

namespace OrdersApi.HiddenTests;

public class OracleSmtpDownTests
{
    [Theory]
    [InlineData(typeof(IOException))]
    [InlineData(typeof(TimeoutException))]
    public async Task Failing_smtp_does_not_break_the_confirmation(Type failure)
    {
        var smtp = new FakeSmtp { Throw = (Exception)Activator.CreateInstance(failure)! };
        var svc = new SmtpNotificationService(smtp, NullLogger<SmtpNotificationService>.Instance);
        await svc.SendOrderConfirmedAsync("a@example.invalid", new Order { Id = 1, Total = 10m }, CancellationToken.None);
        Assert.Equal(1, smtp.Calls);
    }
}
