"use client";

/**
 * O convite depois do primeiro login com senha: "Entrar com biometria da
 * próxima vez?". Aparece uma vez por login, só em aparelho com biometria, e
 * "Agora não" não pergunta mais neste navegador — a opção continua no perfil.
 */
import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  deviceBiometricAvailable,
  dismissBiometricOffer,
  takeBiometricOffer,
  type BiometricAudience,
} from "@/lib/biometrics/webauthn";
import { biometricApi } from "@/lib/biometrics/biometric-api";
import { useEnableBiometric } from "./biometric-section";
import { SecurityConfirmationDialog } from "./security-confirmation-dialog";
import { securityHeaders } from "@/lib/biometrics/security-confirmation";

export function BiometricOffer({
  audience,
  settingsHint,
}: {
  audience: BiometricAudience;
  /** Onde a pessoa ativa depois, dito no convite. */
  settingsHint: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const enable = useEnableBiometric(audience);

  useEffect(() => {
    if (!takeBiometricOffer(audience)) return;
    let alive = true;
    void (async () => {
      if (!(await deviceBiometricAvailable())) return;
      /* Já ativou neste ou em outro aparelho pela web? Não incomoda. */
      const existing = await biometricApi(audience)
        .list()
        .catch(() => null);
      if (!existing || existing.some((item) => item.kind === "WEBAUTHN"))
        return;
      if (alive) setOpen(true);
    })();
    return () => {
      alive = false;
    };
  }, [audience]);

  if (confirming)
    return (
      <SecurityConfirmationDialog
        title="Ativar biometria"
        askForMfa={audience === "team"}
        onClose={() => setConfirming(false)}
        onConfirm={async (credentials) =>
          enable.mutateAsync(
            await securityHeaders(audience, "PASSKEY_REGISTER", credentials),
          )
        }
      />
    );

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Fingerprint className="size-5" aria-hidden />
          </div>
          <AlertDialogTitle>Entrar com biometria?</AlertDialogTitle>
          <AlertDialogDescription>
            Da próxima vez, entre com a digital, o rosto ou o PIN deste
            aparelho, sem digitar a senha. A biometria fica no aparelho. Se
            preferir depois, ative em {settingsHint}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => dismissBiometricOffer(audience)}>
            Agora não
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={enable.isPending}
            onClick={(event) => {
              event.preventDefault();
              setOpen(false);
              setConfirming(true);
            }}
          >
            Ativar biometria
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
