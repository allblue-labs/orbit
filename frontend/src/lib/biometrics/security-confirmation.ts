import { apiClient } from "@/api/client";
import { portalRequest } from "@/portal/portal-client";
import type { BiometricAudience } from "./webauthn";

export type SecurityAction =
  "MFA_ENABLE" | "MFA_DISABLE" | "PASSKEY_REGISTER" | "BIOMETRIC_REVOKE";

export type SecurityCredentials = { currentPassword: string; mfaCode?: string };
type Confirmation = { confirmation: string };

export async function securityHeaders(
  audience: BiometricAudience,
  action: SecurityAction,
  credentials: SecurityCredentials,
): Promise<Record<string, string>> {
  const body = { action, ...credentials };
  const response =
    audience === "team"
      ? await apiClient.post<Confirmation>(
          "/identity/me/security-confirmation",
          body,
          { retries: 0 },
        )
      : await portalRequest<Confirmation>("/me/biometrics/confirmation", {
          method: "POST",
          body,
        });
  return { "x-orbit-security-confirmation": response.confirmation };
}
