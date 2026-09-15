export const PRIVACY_POLICY_VERSION = "2026-09-15";

export type ConsentRole = "SELF_14_PLUS" | "GUARDIAN";
export interface PrivacyConsent {
  policyVersion: string;
  role: ConsentRole;
  consentedAt: Date;
}
