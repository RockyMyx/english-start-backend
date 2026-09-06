import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { AppConfig } from "../config.js";
import type { MembershipPaymentOrderRecord } from "../domain/types.js";
import {
  createVirtualPaymentParameters,
  parseGoodsDeliveryNotification,
  verifyWechatMessageSignature
} from "./virtual-payment-service.js";

const config = {
  wechatAppId: "wx-test",
  wechatAppSecret: "secret",
  wechatVirtualPaymentOfferId: "offer-1",
  wechatVirtualPaymentAppKey: "app-key",
  wechatVirtualPaymentProductId: "membership-year",
  wechatVirtualPaymentEnv: 1,
  membershipPriceFen: 9900,
  membershipDurationDays: 365
} as AppConfig;

const order: MembershipPaymentOrderRecord = {
  outTradeNo: "ES20260906ORDER01",
  userId: "user-1",
  productId: "membership-year",
  amountFen: 9900,
  durationDays: 365,
  env: 1,
  status: "PENDING",
  transactionId: null,
  paidAt: null,
  deliveredAt: null
};

describe("virtual payment", () => {
  it("signs exactly the signData returned to the mini program", () => {
    const payment = createVirtualPaymentParameters(config, order, "session-key");
    expect(JSON.parse(payment.signData)).toMatchObject({
      offerId: "offer-1",
      productId: "membership-year",
      goodsPrice: 9900,
      outTradeNo: order.outTradeNo,
      env: 1
    });
    expect(payment.paySig).toBe(
      createHmac("sha256", "app-key")
        .update(`requestVirtualPayment&${payment.signData}`)
        .digest("hex")
    );
    expect(payment.signature).toBe(
      createHmac("sha256", "session-key").update(payment.signData).digest("hex")
    );
  });

  it("verifies message signatures and parses JSON or XML delivery events", () => {
    const timestamp = "1788681600";
    const nonce = "nonce-1";
    const signature = createHash("sha1")
      .update(["message-token", timestamp, nonce].sort().join(""))
      .digest("hex");
    expect(verifyWechatMessageSignature("message-token", timestamp, nonce, signature)).toBe(true);
    expect(verifyWechatMessageSignature("wrong-token", timestamp, nonce, signature)).toBe(false);

    const jsonEvent = {
      Event: "xpay_goods_deliver_notify",
      OpenId: "openid-1",
      OutTradeNo: order.outTradeNo,
      Env: 1,
      WeChatPayInfo: { TransactionId: "transaction-1", PaidTime: 1788681600 },
      GoodsInfo: { ProductId: "membership-year", Quantity: 1, ActualPrice: 9900 }
    };
    expect(parseGoodsDeliveryNotification(jsonEvent)).toMatchObject({
      openId: "openid-1",
      outTradeNo: order.outTradeNo,
      actualPrice: 9900,
      transactionId: "transaction-1"
    });

    const xml = `<xml><Event><![CDATA[xpay_goods_deliver_notify]]></Event><OpenId><![CDATA[openid-1]]></OpenId><OutTradeNo><![CDATA[${order.outTradeNo}]]></OutTradeNo><Env>1</Env><WeChatPayInfo><TransactionId><![CDATA[transaction-1]]></TransactionId><PaidTime>1788681600</PaidTime></WeChatPayInfo><GoodsInfo><ProductId><![CDATA[membership-year]]></ProductId><Quantity>1</Quantity><ActualPrice>9900</ActualPrice></GoodsInfo></xml>`;
    expect(parseGoodsDeliveryNotification(xml)).toMatchObject({
      openId: "openid-1",
      productId: "membership-year",
      actualPrice: 9900
    });
  });
});
