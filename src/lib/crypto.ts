import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createPinCredential(pin: string): { pinHash: string; pinSalt: string } {
  const pinSalt = randomBytes(16).toString("hex");
  const pinHash = scryptSync(pin, pinSalt, 64).toString("hex");
  return { pinHash, pinSalt };
}

export function verifyPin(pin: string, pinHash: string, pinSalt: string): boolean {
  const actual = scryptSync(pin, pinSalt, 64);
  const expected = Buffer.from(pinHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
