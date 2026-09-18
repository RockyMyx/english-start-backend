ALTER TABLE "UserPrivacyConsent"
  DROP CONSTRAINT "UserPrivacyConsent_role_check";

ALTER TABLE "UserPrivacyConsent"
  ADD CONSTRAINT "UserPrivacyConsent_role_check"
  CHECK ("role" IN ('GENERAL', 'SELF_14_PLUS', 'GUARDIAN'));
