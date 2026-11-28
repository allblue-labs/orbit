"use client";

/**
 * "Entrar com biometria" — só aparece quando o aparelho tem biometria.
 *
 * Não pede e-mail: a passkey sabe de quem é, e o sistema mostra as contas
 * ativadas neste aparelho para a pessoa escolher.
 */
import { useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { biometricApi } from "@/lib/biometrics/biometric-api";
import {
  authenticateWithBiometric,
  biometricFailureMessage,
  type BiometricAudience,
} from "@/lib/biometrics/webauthn";
import { useDeviceBiometric } from "./biometric-section";

export function BiometricSignIn({
  audience,
  onSignedIn,
  className,
}: {
  audience: BiometricAudience;
  onSignedIn: (result: unknown) => void | Promise<void>;
  className?: string;
}) {
  const available = useDeviceBiometric();
  const [pending, setPending] = useState(false);
  if (!available) return null;

  async function signIn() {
    setPending(true);
    try {
      const api = biometricApi(audience);
      const result = await authenticateWithBiometric({
        challenge: () => api.loginChallenge(),
        verify: (input) => api.login(input),
      });
      await onSignedIn(result);
    } catch (error) {
      const message = biometricFailureMessage(error);
      if (message) toast.error(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="lg"
      className={className ?? "w-full"}
      disabled={pending}
      onClick={() => void signIn()}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <Fingerprint className="size-4" />
      )}
      Entrar com biometria
    </Button>
  );
}
