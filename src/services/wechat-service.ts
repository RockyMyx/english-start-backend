import type { AppConfig } from "../config.js";
import { AppError } from "../lib/errors.js";

interface Code2SessionResponse {
  openid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

export interface WechatSession {
  openId: string;
  sessionKey: string;
}

export async function resolveWechatSession(code: string, config: AppConfig): Promise<WechatSession> {
  if (!config.wechatAppId || !config.wechatAppSecret) {
    throw new AppError(503, "WECHAT_NOT_CONFIGURED", "微信登录尚未配置");
  }

  const query = new URLSearchParams({
    appid: config.wechatAppId,
    secret: config.wechatAppSecret,
    js_code: code,
    grant_type: "authorization_code"
  });
  const response = await fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`);
  const data = (await response.json()) as Code2SessionResponse;

  if (!response.ok || !data.openid || !data.session_key) {
    throw new AppError(502, "WECHAT_LOGIN_FAILED", data.errmsg || "微信登录失败");
  }
  return { openId: data.openid, sessionKey: data.session_key };
}

export async function resolveWechatOpenId(code: string, config: AppConfig): Promise<string> {
  return (await resolveWechatSession(code, config)).openId;
}
