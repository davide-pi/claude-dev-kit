using OrdersApi.Models;

namespace OrdersApi.Services;

public interface INotificationService
{
    Task SendOrderConfirmedAsync(string email, Order order, CancellationToken ct);
}

public sealed class SmtpNotificationService : INotificationService
{
    private readonly ISmtpClient _smtp;
    private readonly ILogger<SmtpNotificationService> _log;

    public SmtpNotificationService(ISmtpClient smtp, ILogger<SmtpNotificationService> log)
    {
        _smtp = smtp;
        _log = log;
    }

    public async Task SendOrderConfirmedAsync(string email, Order order, CancellationToken ct)
    {
        var body = $"Your order {order.Id} for {order.Total:C} has been confirmed.";
        try
        {
            await _smtp.SendAsync(email, "Order confirmed", body, ct);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Could not send confirmation for order {OrderId}", order.Id);
        }
    }
}

public interface ISmtpClient
{
    Task SendAsync(string to, string subject, string body, CancellationToken ct);
}
