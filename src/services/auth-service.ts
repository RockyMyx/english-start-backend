import { randomBytes } from "node:crypto";
import type { AppConfig } from "../config.js";
import type { IdentityContext, SessionRecord } from "../domain/types.js";
import { AppError } from "../lib/errors.js";
import { sha256 } from "../lib/crypto.js";
import type { AppRepository } from "../repositories/app-repository.js";

export interface AuthenticatedSession {
  session: SessionRecord;
  context: IdentityContext;
}

export class AuthService {
  constructor(
    private readonly repository: AppRepository,
    private readonly config: AppConfig
  ) {}

  async loginWithOpenId(openId: string): Promise<{ token: string; context: IdentityContext }> {
    const context = await this.repository.ensureIdentity(openId);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.sessionTtlDays * 86_400_000);
    await this.repository.createSession({
      userId: context.userId,
      tokenHash: sha256(token),
      expiresAt
    });
    return { token, context };
  }

  async authenticate(authorization: string | undefined): Promise<AuthenticatedSession> {
    const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) throw new AppError(401, "UNAUTHENTICATED", "请先登录");
    const session = await this.repository.getSessionByTokenHash(sha256(token));
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      throw new AppError(401, "SESSION_EXPIRED", "登录已过期，请重新登录");
    }
    return {
      session,
      context: await this.repository.getContext(session.userId)
    };
  }
}
