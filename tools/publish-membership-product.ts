import "dotenv/config";
import { loadConfig } from "../src/config.js";
import {
  requestVirtualPaymentApi,
  requireVirtualPayment
} from "../src/services/virtual-payment-service.js";

interface GoodsTaskItem {
  id?: string;
  upload_status?: number;
  publish_status?: number;
  errmsg?: string;
}

interface GoodsTaskResponse {
  errcode?: number;
  errmsg?: string;
  status?: number;
  upload_item?: GoodsTaskItem[];
  publish_item?: GoodsTaskItem[];
}

function optionValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function taskError(items: GoodsTaskItem[] | undefined): string {
  return items?.map((item) => item.errmsg).filter(Boolean).join("；") || "微信未返回失败原因";
}

async function waitForTask(
  endpoint: "/xpay/query_upload_goods" | "/xpay/query_publish_goods",
  itemField: "upload_item" | "publish_item",
  timeoutMs = 60_000
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = await requestVirtualPaymentApi<GoodsTaskResponse>(config, endpoint, {
      env: config.wechatVirtualPaymentEnv
    });
    if (result.status === 3) return;
    if (result.status === 2) throw new Error(taskError(result[itemField]));
    await delay(2_000);
  }
  throw new Error("微信道具任务仍在处理中，请稍后重新查询");
}

const config = loadConfig();
requireVirtualPayment(config);
const imageUrl = optionValue("--image-url")?.trim()
  || process.env.MEMBERSHIP_PRODUCT_IMAGE_URL?.trim()
  || "https://wx.rockyma.online/media/membership-product.png";
const name = optionValue("--name")?.trim() || "年度会员";
const remark = optionValue("--remark")?.trim() || `购买后获得 ${config.membershipDurationDays} 天会员权益`;

if (!/^https:\/\//i.test(imageUrl)) {
  throw new Error("商品图片地址必须是公开可访问的 HTTPS URL");
}
if (name.length > 20) throw new Error("道具名称不能超过 20 个字符");
if (remark.length > 1024) throw new Error("道具备注不能超过 1024 个字符");

console.log(`开始上传道具 ${config.wechatVirtualPaymentProductId}（${config.membershipPriceFen} 分）`);
await requestVirtualPaymentApi<GoodsTaskResponse>(config, "/xpay/start_upload_goods", {
  upload_item: [{
    id: config.wechatVirtualPaymentProductId,
    name,
    price: config.membershipPriceFen,
    remark,
    item_url: imageUrl
  }],
  env: config.wechatVirtualPaymentEnv
});
await waitForTask("/xpay/query_upload_goods", "upload_item");

console.log("上传成功，开始发布道具");
await requestVirtualPaymentApi<GoodsTaskResponse>(config, "/xpay/start_publish_goods", {
  publish_item: [{ id: config.wechatVirtualPaymentProductId }],
  env: config.wechatVirtualPaymentEnv
});
await waitForTask("/xpay/query_publish_goods", "publish_item");

console.log("年度会员道具发布成功，请等待约 10 分钟后重新测试支付");
