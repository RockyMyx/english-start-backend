CREATE TABLE "UserPrivacyConsent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "consentedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserPrivacyConsent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UserPrivacyConsent_role_check" CHECK ("role" IN ('SELF_14_PLUS', 'GUARDIAN'))
);
CREATE UNIQUE INDEX "UserPrivacyConsent_userId_policyVersion_key" ON "UserPrivacyConsent"("userId", "policyVersion");
ALTER TABLE "UserPrivacyConsent" ADD CONSTRAINT "UserPrivacyConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
