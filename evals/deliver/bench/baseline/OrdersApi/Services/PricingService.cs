namespace OrdersApi.Services;

public static class PricingService
{
    private const decimal PremiumRate = 0.10m;

    public static decimal ApplyPremiumDiscount(decimal total, bool isPremium)
        => isPremium ? Math.Round(total * (1 - PremiumRate), 2) : total;
}
