using OrdersApi.Services;
using Xunit;

namespace OrdersApi.HiddenTests;

public class OracleDiscountTests
{
    [Theory]
    [InlineData(200, 180)]
    [InlineData(19.99, 17.99)]
    public void Premium_gets_ten_percent_off(double total, double expected)
        => Assert.Equal((decimal)expected, PricingService.ApplyPremiumDiscount((decimal)total, true));

    [Fact]
    public void Non_premium_pays_full_price()
        => Assert.Equal(200m, PricingService.ApplyPremiumDiscount(200m, false));
}
