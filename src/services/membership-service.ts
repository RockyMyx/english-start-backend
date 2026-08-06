import type { IdentityContext } from "../domain/types.js";
import { sha256 } from "../lib/crypto.js";
import { AppError } from "../lib/errors.js";
import type { AppRepository } from "../repositories/app-repository.js";

export function normalizeRedemptionCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, "");
}

export function redemptionCodeHash(value: string): string {
  return sha256(normalizeRedemptionCode(value));
}

export async function requireMembership(
  repository: AppRepository,
  context: IdentityContext
): Promise<void> {
  const membership = await repository.getMembershipStatus(context);
  if (!membership.active) {
    throw new AppError(403, "MEMBERSHIP_REQUIRED", "该功能需要开通会员");
  }
}
