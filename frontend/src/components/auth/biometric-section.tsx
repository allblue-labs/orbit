"use client";

/**
 * Entrar com biometria — o cadastro, para a equipe e para o cliente.
 *
 * Ativar cria uma passkey neste aparelho: o sistema pede a digital, o rosto
 * ou o PIN, e o servidor guarda só a parte pública da chave. A lista mostra
 * também os aparelhos ativados pelo app, para remover o que se perdeu.
 */
import { useEffect, useState } from "react";
import { Fingerprint, Smartphone, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { biometricApi } from "@/lib/biometrics/biometric-api";
import {
  biometricFailureMessage,
  deviceBiometricAvailable,
  registerBiometric,
  type BiometricAudience,
} from "@/lib/biometrics/webauthn";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import { securityHeaders } from "@/lib/biometrics/security-confirmation";
import { SecurityConfirmationDialog } from "./security-confirmation-dialog";

export const biometricKeys = (audience: BiometricAudience) =>
  ["biometrics", audience] as const;

/** O aparelho tem biometria? `null` enquanto pergunta ao navegador. */
export function useDeviceBiometric(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void deviceBiometricAvailable().then((value) => {
      if (alive) setAvailable(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return available;
}

/** Ativa a biometria neste aparelho; devolve `true` se ativou. */
export function useEnableBiometric(audience: BiometricAudience) {
  const client = useQueryClient();
  const api = biometricApi(audience);
  return useMutation({
    mutationFn: async (headers: Record<string, string>) => {
      try {
        await registerBiometric({
          challenge: () => api.registrationChallenge(),
          register: (input) => api.register(input, headers),
        });
        return true;
      } catch (error) {
        const message = biometricFailureMessage(error);
        if (message) toast.error(message);
        return false;
      }
    },
    onSuccess: (enabled) => {
      if (!enabled) return;
      toast.success("Biometria ativada. No próximo acesso, é só tocar.");
      void client.invalidateQueries({ queryKey: biometricKeys(audience) });
    },
  });
}

export function BiometricSection({
  audience,
}: {
  audience: BiometricAudience;
}) {
  const { formatDateTime } = useDateFormatters();
  const client = useQueryClient();
  const api = biometricApi(audience);
  const available = useDeviceBiometric();
  const list = useQuery({
    queryKey: biometricKeys(audience),
    queryFn: () => api.list(),
  });
  const enable = useEnableBiometric(audience);
  const [confirming, setConfirming] = useState<{ id?: string } | null>(null);
  const remove = useMutation({
    mutationFn: ({
      id,
      headers,
    }: {
      id: string;
      headers: Record<string, string>;
    }) => api.remove(id, headers),
    onSuccess: () => {
      toast.success("Biometria removida.");
      void client.invalidateQueries({ queryKey: biometricKeys(audience) });
    },
    onError: () => toast.error("Não foi possível remover agora."),
  });
  const items = list.data ?? [];

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Fingerprint className="size-4 text-muted-foreground" aria-hidden />
          Entrar com biometria
        </h2>
        <p className="text-xs text-muted-foreground">
          Use a digital, o rosto ou o PIN do aparelho no lugar da senha. A
          biometria fica no aparelho — o Orbit nunca a recebe.
        </p>
      </div>

      {list.isPending ? (
        <Skeleton className="h-14 w-full rounded-xl" />
      ) : items.length ? (
        <ul className="glass-panel divide-y divide-border rounded-xl">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              {item.kind === "DEVICE" ? (
                <Smartphone
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <Fingerprint
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">
                  {item.kind === "DEVICE" ? "Aplicativo" : "Navegador"} ·{" "}
                  {item.lastUsedAt
                    ? `usado em ${formatDateTime(item.lastUsedAt)}`
                    : `ativado em ${formatDateTime(item.createdAt)}`}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive"
                disabled={remove.isPending}
                onClick={() => setConfirming({ id: item.id })}
              >
                <Trash2 className="size-4" />
                Remover
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {available === false ? (
        <p className="text-xs text-muted-foreground">
          Este navegador não encontrou biometria neste aparelho. Num celular ou
          computador com digital ou reconhecimento facial, a opção aparece aqui.
        </p>
      ) : (
        <Button
          variant="outline"
          size="sm"
          disabled={!available || enable.isPending}
          onClick={() => setConfirming({})}
        >
          <Fingerprint className="size-4" />
          {enable.isPending
            ? "Aguardando o aparelho…"
            : "Ativar neste aparelho"}
        </Button>
      )}
      {confirming && (
        <SecurityConfirmationDialog
          title={confirming.id ? "Remover biometria" : "Ativar biometria"}
          askForMfa={audience === "team"}
          onClose={() => setConfirming(null)}
          onConfirm={async (credentials) => {
            const headers = await securityHeaders(
              audience,
              confirming.id ? "BIOMETRIC_REVOKE" : "PASSKEY_REGISTER",
              credentials,
            );
            if (!confirming.id) return enable.mutateAsync(headers);
            await remove.mutateAsync({ id: confirming.id, headers });
            return true;
          }}
        />
      )}
    </section>
  );
}
