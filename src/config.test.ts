import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "./config.js";
import { createVirtualPaymentParameters, membershipProduct } from "./services/virtual-payment-service.js";

beforeEach(() => {
  for (const key of [
    "MEMBERSHIP_PAYMENT_MODE",
    "MEMBERSHIP_PRICE_FEN",
    "WECHAT_VIRTUAL_PAYMENT_PRODUCT_ID",
    "MEMBERSHIP_TEST_PRICE_FEN",
    "MEMBERSHIP_TEST_PRODUCT_ID",
    "MEMBERSHIP_LIVE_PRICE_FEN",
    "MEMBERSHIP_LIVE_PRODUCT_ID",
    "MEMBERSHIP_DURATION_DAYS",
    "WECHAT_VIRTUAL_PAYMENT_ENV"
  ]) {
    vi.stubEnv(key, undefined);
  }
});

afterEach(() => vi.unstubAllEnvs());

describe("membership payment configuration", () => {
  it("preserves legacy defaults when no mode is configured", () => {
    expect(loadConfig()).toMatchObject({
      membershipPriceFen: 9900,
      wechatVirtualPaymentProductId: "",
      membershipDurationDays: 365
    });
  });

  it("preserves configured legacy price and product without a mode", () => {
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", " ");
    vi.stubEnv("MEMBERSHIP_PRICE_FEN", "2500");
    vi.stubEnv("WECHAT_VIRTUAL_PAYMENT_PRODUCT_ID", "legacy_product");
    vi.stubEnv("MEMBERSHIP_DURATION_DAYS", "14");
    expect(loadConfig()).toMatchObject({
      membershipPriceFen: 2500,
      wechatVirtualPaymentProductId: "legacy_product",
      membershipDurationDays: 14
    });
  });

  it("selects the one-yuan test product independently of NODE_ENV", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", "test");
    vi.stubEnv("MEMBERSHIP_PRICE_FEN", "9900");
    vi.stubEnv("WECHAT_VIRTUAL_PAYMENT_PRODUCT_ID", "membership_year");
    const config = loadConfig();
    expect(config).toMatchObject({
      nodeEnv: "production",
      membershipPriceFen: 100,
      wechatVirtualPaymentProductId: "membership_year_test",
      membershipDurationDays: 365
    });
    expect(membershipProduct(config).priceFen).toBe(100);
  });

  it("does not leak a legacy test price into explicit live mode", () => {
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", "live");
    vi.stubEnv("MEMBERSHIP_PRICE_FEN", "100");
    vi.stubEnv("WECHAT_VIRTUAL_PAYMENT_PRODUCT_ID", "membership_year_test");
    expect(loadConfig()).toMatchObject({
      membershipPriceFen: 9900,
      wechatVirtualPaymentProductId: "membership_year"
    });
  });

  it.each([
    ["test", "MEMBERSHIP_TEST", 200, "custom_test"],
    ["live", "MEMBERSHIP_LIVE", 7900, "custom_live"]
  ] as const)("supports custom %s price and product", (mode, prefix, price, productId) => {
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", mode);
    vi.stubEnv(`${prefix}_PRICE_FEN`, String(price));
    vi.stubEnv(`${prefix}_PRODUCT_ID`, productId);
    expect(loadConfig()).toMatchObject({
      membershipPriceFen: price,
      wechatVirtualPaymentProductId: productId
    });
  });

  it("switches both price and product together", () => {
    vi.stubEnv("MEMBERSHIP_TEST_PRICE_FEN", "200");
    vi.stubEnv("MEMBERSHIP_TEST_PRODUCT_ID", "test_2yuan");
    vi.stubEnv("MEMBERSHIP_LIVE_PRICE_FEN", "8900");
    vi.stubEnv("MEMBERSHIP_LIVE_PRODUCT_ID", "live_89yuan");
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", "test");
    expect(loadConfig()).toMatchObject({
      membershipPriceFen: 200,
      wechatVirtualPaymentProductId: "test_2yuan"
    });
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", "live");
    expect(loadConfig()).toMatchObject({
      membershipPriceFen: 8900,
      wechatVirtualPaymentProductId: "live_89yuan"
    });
  });

  it.each([
    ["test", 100, "membership_year_test"],
    ["live", 9900, "membership_year"]
  ] as const)("uses the selected %s price and product in payment parameters", (mode, price, productId) => {
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", mode);
    const config = {
      ...loadConfig(),
      wechatAppId: "wx-test-app",
      wechatAppSecret: "fixture-secret",
      wechatVirtualPaymentOfferId: "fixture-offer",
      wechatVirtualPaymentAppKey: "fixture-key"
    };
    const payment = createVirtualPaymentParameters(config, {
      outTradeNo: "ESMODETEST01",
      userId: "user-test",
      productId: config.wechatVirtualPaymentProductId,
      amountFen: config.membershipPriceFen,
      durationDays: config.membershipDurationDays,
      env: config.wechatVirtualPaymentEnv,
      status: "PENDING",
      transactionId: null,
      paidAt: null,
      deliveredAt: null
    }, "fixture-session");
    expect(JSON.parse(payment.signData)).toMatchObject({ goodsPrice: price, productId });
  });

  it.each(["production", "debug", "invalid"])("rejects an unsupported mode %s", (mode) => {
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", mode);
    expect(() => loadConfig()).toThrow("MEMBERSHIP_PAYMENT_MODE 必须为 test 或 live");
  });

  it.each(["0", "-1", "0.5", "100.5", "abc", "Infinity", "9007199254740992"])(
    "rejects invalid explicit prices %s in both modes",
    (price) => {
      for (const mode of ["test", "live"]) {
        vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", mode);
        const key = `MEMBERSHIP_${mode.toUpperCase()}_PRICE_FEN`;
        vi.stubEnv(key, price);
        expect(() => loadConfig()).toThrow(`${key} 必须是正整数，单位为分`);
      }
    }
  );

  it.each([
    ["test", "0", 0],
    ["live", "1", 1]
  ] as const)("keeps WeChat payment environment independent of %s mode", (mode, env, expected) => {
    vi.stubEnv("MEMBERSHIP_PAYMENT_MODE", mode);
    vi.stubEnv("WECHAT_VIRTUAL_PAYMENT_ENV", env);
    vi.stubEnv("WECHAT_VIRTUAL_PAYMENT_APP_KEY", "test-key-fixture");
    expect(loadConfig()).toMatchObject({
      wechatVirtualPaymentEnv: expected,
      wechatVirtualPaymentAppKey: "test-key-fixture"
    });
  });
});
