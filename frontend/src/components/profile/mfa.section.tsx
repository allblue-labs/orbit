"use client";

/**
 * Autenticação em dois fatores.
 *
 * ## Já existia no backend
 *
 * `POST /identity/me/mfa/enrollment` devolve `factorId`, `secret` e uma URI
 * `otpauth://`; `POST /mfa/enable` confirma com o código; `DELETE /mfa`
 * desativa. Esta PR apenas passou a consumi-los — nenhum contrato foi criado.
 *
 * ## O segredo aparece uma vez
 *
 * Cada chamada de `enrollment` gera um **fator novo**. Por isso é mutação, não
 * consulta: um `useQuery` a dispararia ao montar e trocaria o segredo debaixo
 * de quem estava no meio do cadastro.
 *
 * ## O QR vem desenhado do servidor
 *
 * A tela mostrava só o segredo em base32 e pedia que a pessoa o digitasse:
 * trinta e dois caracteres sem sentido, num celular, e um erro basta para o
 * código nunca bater. Apontar a câmera é o caminho que todo aplicativo
 * autenticador espera.
 *
 * Quem desenha é o servidor, que já tem a biblioteca por causa do QR de
 * equipamento. Nada é exposto a mais: o código **é** a mesma URI `otpauth://`
 * que sempre foi enviada na resposta.
 *
 * O segredo digitável continua disponível, recolhido, para quem não consegue
 * usar a câmera.
 */
import { useState } from "react";
import { ShieldCheck, ShieldPlus } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useBeginMfaEnrollment,
  useDisableMfa,
  useEnableMfa,
} from "@/hooks/profile/use-profile";
import type { MfaEnrollment } from "@/types/settings";

/** O número do passo, num disco — a lista fica legível sem depender da ordem. */
function Passo({ numero }: { numero: number }) {
  return (
    <span className="bg-primary text-primary-foreground flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium">
      {numero}
    </span>
  );
}

export function MfaSection({ enabled }: { enabled: boolean }) {
  const begin = useBeginMfaEnrollment();
  const enable = useEnableMfa();
  const disable = useDisableMfa();

  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState("");

  if (enabled) {
    return (
      <section className="glass-panel space-y-3 rounded-xl p-5">
        <h2 className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <ShieldCheck className="size-4 text-emerald-400" aria-hidden />
          Autenticação em dois fatores
          <Badge variant="secondary">ativa</Badge>
        </h2>
        <p className="text-sm text-muted-foreground">
          Sua conta pede um código do aplicativo autenticador a cada novo
          acesso.
        </p>

        <MutationError error={disable.error} />

        <Button
          variant="outline"
          size="sm"
          disabled={disable.isPending}
          onClick={() => disable.mutate()}
        >
          {disable.isPending ? "Desativando…" : "Desativar"}
        </Button>
      </section>
    );
  }

  return (
    <section className="glass-panel space-y-4 rounded-xl p-5">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <ShieldPlus className="size-4 text-muted-foreground" aria-hidden />
          Autenticação em dois fatores
        </h2>
        <p className="text-xs text-muted-foreground">
          Um código do aplicativo autenticador passa a ser exigido junto da
          senha.
        </p>
      </div>

      {enrollment ? (
        <div className="space-y-4">
          <div className="space-y-4 rounded-lg border border-border p-4">
            <ol className="space-y-3 text-sm">
              <li className="flex gap-3">
                <Passo numero={1} />
                <span>
                  Instale um aplicativo autenticador no celular, se ainda não
                  tiver: <strong>Google Authenticator</strong>,{" "}
                  <strong>Microsoft Authenticator</strong> ou{" "}
                  <strong>Authy</strong> servem.
                </span>
              </li>
              <li className="flex gap-3">
                <Passo numero={2} />
                <span>
                  No aplicativo, toque em adicionar conta e escolha ler código
                  QR. Aponte a câmera para o código abaixo.
                </span>
              </li>
              <li className="flex gap-3">
                <Passo numero={3} />
                <span>
                  O aplicativo passa a mostrar um código de seis dígitos que
                  troca a cada 30 segundos. Digite o código atual no campo
                  abaixo para concluir.
                </span>
              </li>
            </ol>

            {/* Sobre branco: leitor de QR espera módulos escuros sobre fundo
                claro, e num tema escuro o código sai invertido e não é lido. */}
            <div className="flex justify-center rounded-lg bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enrollment.qrCode}
                alt="Código QR para o aplicativo autenticador"
                className="size-44"
              />
            </div>

            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer">
                Não consigo usar a câmera
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-muted-foreground">
                  Escolha a opção de digitar uma chave no aplicativo e informe
                  este segredo:
                </p>
                <p className="font-mono text-sm break-all select-all">
                  {enrollment.secret}
                </p>
              </div>
            </details>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              enable.mutate(
                { factorId: enrollment.factorId, code: code.trim() },
                {
                  onSuccess: () => {
                    setEnrollment(null);
                    setCode("");
                  },
                },
              );
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-2">
              <Label htmlFor="mfa-code">Código do aplicativo</Label>
              <Input
                id="mfa-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                className="w-32 font-mono"
              />
            </div>

            <Button type="submit" disabled={!code.trim() || enable.isPending}>
              {enable.isPending ? "Confirmando…" : "Ativar"}
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEnrollment(null);
                setCode("");
              }}
            >
              Cancelar
            </Button>
          </form>

          <MutationError error={enable.error} />
        </div>
      ) : (
        <>
          <MutationError error={begin.error} />
          <Button
            variant="outline"
            size="sm"
            disabled={begin.isPending}
            onClick={() =>
              begin.mutate(undefined, { onSuccess: setEnrollment })
            }
          >
            {begin.isPending ? "Gerando…" : "Configurar"}
          </Button>
        </>
      )}
    </section>
  );
}
