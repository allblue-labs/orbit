"use client";

/**
 * O link pelo qual o contratante assina o contrato do PMOC, para o dono repassar.
 *
 * ## Por que o link aparece numa tela em vez de ser enviado
 *
 * Porque o Orbit não tem o e-mail do contratante de forma confiável — o cadastro do
 * cliente guarda o contato comercial, que muitas vezes não é quem assina. Entregar o
 * link ao dono deixa a escolha do canal com quem conhece a pessoa, e é o mesmo
 * raciocínio do link de senha da equipe: WhatsApp é onde a resposta vem.
 *
 * ## O token existe uma única vez
 *
 * O servidor guarda apenas o hash. Fechada esta janela, não há como recuperar o
 * token — gera-se outro, e o ato de gerar revoga o anterior. É isso que o aviso
 * abaixo diz, e é a razão de o diálogo não ter como ser reaberto com o mesmo valor.
 */
import { useState } from "react";
import { Check, Copy, MessageCircle, Send, TriangleAlert } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/formatters";
import { pmocContractUrl } from "@/lib/routes";
import type { PmocSignatureLink } from "@/types/pmoc";

export function PmocSignatureLinkDialog({
  resultado,
  error,
  isPending,
  onOpenChange,
}: {
  resultado: PmocSignatureLink | null;
  error: Parameters<typeof MutationError>[0]["error"];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const aberto = isPending || Boolean(resultado) || Boolean(error);
  const [copiado, setCopiado] = useState(false);

  if (!aberto) return null;

  /**
   * A origem vem do navegador.
   *
   * O backend devolve só o token — ele não sabe por qual domínio esta instalação
   * atende, e adivinhar produziria um link que abre em "localhost" na máquina de
   * quem o gerou.
   */
  const link = resultado
    ? pmocContractUrl(window.location.origin, resultado.token)
    : "";

  const mensagem = resultado
    ? `Olá! Segue o contrato do plano de manutenção ${resultado.planCode} para sua conferência e assinatura: ${link}`
    : "";

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
    } catch {
      /* Sem área de transferência: o link está na tela para ser selecionado. */
    }
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(next) => {
        if (!next) {
          setCopiado(false);
          onOpenChange(false);
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link de assinatura do contrato</DialogTitle>
          <DialogDescription>
            {resultado
              ? `Plano ${resultado.planCode}. Vale até ${formatDateTime(
                  resultado.expiresAt,
                )}.`
              : "Gerando…"}
          </DialogDescription>
        </DialogHeader>

        <MutationError error={error} />

        {resultado ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p
                className="break-all font-mono text-xs"
                data-testid="pmoc-signature-link"
              >
                {link}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <Button type="button" variant="outline" onClick={copiar}>
                {copiado ? (
                  <Check className="size-4" />
                ) : (
                  <Copy className="size-4" />
                )}
                {copiado ? "Copiado" : "Copiar"}
              </Button>

              {/* `noreferrer` junto de `noopener`: o destino é um mensageiro de
                  terceiro, e o link é a credencial do contrato — não há motivo
                  para contar a ele de que página saiu. */}
              <Button asChild type="button" variant="outline">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle className="size-4" />
                  WhatsApp
                </a>
              </Button>

              <Button asChild type="button" variant="outline">
                <a
                  href={`https://t.me/share/url?url=${encodeURIComponent(
                    link,
                  )}&text=${encodeURIComponent(
                    "Contrato do plano de manutenção para assinatura",
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Send className="size-4" />
                  Telegram
                </a>
              </Button>
            </div>

            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Copie agora: o link não pode ser consultado depois. Gerar outro
                para este contrato invalida este na mesma hora.
              </span>
            </p>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
