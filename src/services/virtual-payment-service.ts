import { createHash, createHmac, randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { MembershipPaymentOrderRecord } from "../domain/types.js";
import { AppError } from "../lib/errors.js";

export interface VirtualPaymentParameters {
  outTradeNo: string;
  signData: string;
  paySig: string;
  signature: string;
  mode: "short_series_goods";
}

export interface VirtualPaymentQueryResult {
  status: number;
  paidFee: number;
  paidAt: Date | null;
  transactionId: string | null;
}

export interface GoodsDeliveryNotification {
  event: "xpay_goods_deliver_notify";
  openId: string;
  outTradeNo: string;
  env: 0 | 1;
  productId: string;
  quantity: number;
  actualPrice: number;
  transactionId: string | null;
  paidAt: Date;
}

interface AccessTokenCache {
  value: string;
  expiresAt: number;
}

let accessTokenCache: AccessTokenCache | null = null;

function hmacSha256(key: string, content: string): string {
  return createHmac("sha256", key).update(content, "utf8").digest("hex");
}

export function membershipProduct(config: AppConfig) {
  return {
    name: "年度会员",
    priceFen: config.membershipPriceFen,
    durationDays: config.membershipDurationDays,
    available: Boolean(
      config.wechatAppId &&
      config.wechatAppSecret &&
      config.wechatVirtualPaymentOfferId &&
      config.wechatVirtualPaymentAppKey &&
      config.wechatVirtualPaymentProductId
    )
  };
}

export function requireVirtualPayment(config: AppConfig): void {
  if (!membershipProduct(config).available) {
    throw new AppError(503, "VIRTUAL_PAYMENT_NOT_CONFIGURED", "会员支付尚未配置完成");
  }
}

export function createMembershipTradeNo(now = new Date()): string {
  return `ES${now.getTime().toString(36)}${randomBytes(6).toString("hex")}`.toUpperCase();
}

export function createVirtualPaymentParameters(
  config: AppConfig,
  order: MembershipPaymentOrderRecord,
  sessionKey: string
): VirtualPaymentParameters {
  requireVirtualPayment(config);
  const signData = JSON.stringify({
    offerId: config.wechatVirtualPaymentOfferId,
    buyQuantity: 1,
    env: order.env,
    currencyType: "CNY",
    productId: order.productId,
    goodsPrice: order.amountFen,
    outTradeNo: order.outTradeNo,
    attach: `membership:${order.outTradeNo}`
  });
  return {
    outTradeNo: order.outTradeNo,
    signData,
    paySig: hmacSha256(
      config.wechatVirtualPaymentAppKey,
      `requestVirtualPayment&${signData}`
    ),
    signature: hmacSha256(sessionKey, signData),
    mode: "short_series_goods"
  };
}

export function verifyWechatMessageSignature(
  token: string,
  timestamp: string,
  nonce: string,
  signature: string
): boolean {
  if (!token || !timestamp || !nonce || !signature) return false;
  const expected = createHash("sha1")
    .update([token, timestamp, nonce].sort().join(""), "utf8")
    .digest("hex");
  return expected === signature.toLowerCase();
}

function xmlValue(xml: string, name: string): string {
  const match = xml.match(new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, "i"));
  return match?.[1]?.trim() || "";
}

function nestedRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

export function parseGoodsDeliveryNotification(body: unknown): GoodsDeliveryNotification {
  const record = typeof body === "string" ? {
    Event: xmlValue(body, "Event"),
    OpenId: xmlValue(body, "OpenId"),
    OutTradeNo: xmlValue(body, "OutTradeNo"),
    Env: xmlValue(body, "Env"),
    TransactionId: xmlValue(body, "TransactionId"),
    PaidTime: xmlValue(body, "PaidTime"),
    ProductId: xmlValue(body, "ProductId"),
    Quantity: xmlValue(body, "Quantity"),
    ActualPrice: xmlValue(body, "ActualPrice")
  } : nestedRecord(body);
  const goods = nestedRecord(record.GoodsInfo);
  const pay = nestedRecord(record.WeChatPayInfo);
  const event = textField(record, "Event");
  const openId = textField(record, "OpenId");
  const outTradeNo = textField(record, "OutTradeNo");
  const env = Number(textField(record, "Env"));
  const productId = textField(goods, "ProductId") || textField(record, "ProductId");
  const quantity = Number(textField(goods, "Quantity") || textField(record, "Quantity"));
  const actualPrice = Number(textField(goods, "ActualPrice") || textField(record, "ActualPrice"));
  const transactionId = textField(pay, "TransactionId") || textField(record, "TransactionId") || null;
  const paidTime = Number(textField(pay, "PaidTime") || textField(record, "PaidTime"));
  if (
    event !== "xpay_goods_deliver_notify" ||
    !openId ||
    !outTradeNo ||
    (env !== 0 && env !== 1) ||
    !productId ||
    quantity !== 1 ||
    !Number.isInteger(actualPrice) ||
    actualPrice <= 0
  ) {
    throw new AppError(400, "INVALID_XPAY_NOTIFICATION", "虚拟支付通知内容不正确");
  }
  return {
    event,
    openId,
    outTradeNo,
    env,
    productId,
    quantity,
    actualPrice,
    transactionId,
    paidAt: Number.isFinite(paidTime) && paidTime > 0 ? new Date(paidTime * 1000) : new Date()
  };
}

async function getAccessToken(config: AppConfig): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) return accessTokenCache.value;
  const query = new URLSearchParams({
    grant_type: "client_credential",
    appid: config.wechatAppId,
    secret: config.wechatAppSecret
  });
  const response = await fetch(`https://api.weixin.qq.com/cgi-bin/token?${query}`);
  const data = await response.json() as {
    access_token?: string;
    expires_in?: number;
    errcode?: number;
    errmsg?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new AppError(502, "WECHAT_ACCESS_TOKEN_FAILED", data.errmsg || "获取微信接口凭证失败");
  }
  accessTokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60, (data.expires_in || 7200) - 300) * 1000
  };
  return data.access_token;
}

export async function requestVirtualPaymentApi<T extends { errcode?: number; errmsg?: string }>(
  config: AppConfig,
  endpoint: string,
  payload: Record<string, unknown>
): Promise<T> {
  requireVirtualPayment(config);
  if (!/^\/xpay\/[a-z_]+$/.test(endpoint)) {
    throw new AppError(500, "INVALID_XPAY_ENDPOINT", "虚拟支付接口地址不正确");
  }
  const body = JSON.stringify(payload);
  const paySig = hmacSha256(config.wechatVirtualPaymentAppKey, `${endpoint}&${body}`);
  const accessToken = await getAccessToken(config);
  const query = new URLSearchParams({ access_token: accessToken, pay_sig: paySig });
  const response = await fetch(`https://api.weixin.qq.com${endpoint}?${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  });
  const data = await response.json() as T;
  if (!response.ok || data.errcode !== 0) {
    throw new AppError(502, "XPAY_API_FAILED", data.errmsg || "微信虚拟支付接口调用失败");
  }
  return data;
}

export async function queryVirtualPaymentOrder(
  config: AppConfig,
  openId: string,
  outTradeNo: string
): Promise<VirtualPaymentQueryResult> {
  const data = await requestVirtualPaymentApi<{
    errcode?: number;
    errmsg?: string;
    order?: {
      status?: number;
      paid_fee?: number;
      paid_time?: number;
      wxpay_order_id?: string;
      channel_order_id?: string;
    };
  }>(config, "/xpay/query_order", {
    openid: openId,
    env: config.wechatVirtualPaymentEnv,
    order_id: outTradeNo
  });
  if (!data.order || typeof data.order.status !== "number") {
    throw new AppError(502, "XPAY_QUERY_FAILED", data.errmsg || "查询会员支付结果失败");
  }
  return {
    status: data.order.status,
    paidFee: Number(data.order.paid_fee || 0),
    paidAt: data.order.paid_time ? new Date(data.order.paid_time * 1000) : null,
    transactionId: data.order.wxpay_order_id || data.order.channel_order_id || null
  };
}
