"use client";

/**
 * O link de definição de senha de um membro, para o owner repassar.
 *
 * ## Por que compartilhar por mensageiro é o caminho principal, e não o desvio
 *
 * Metade de uma equipe de campo não usa e-mail no trabalho. O link chega por
 * WhatsApp porque é onde a pessoa vai ver — e o servidor tenta o e-mail no
 * mesmo pedido, para quem tem caixa postal. `emailSent` diz qual dos dois
 * aconteceu, em vez de deixar o owner adivinhar.
 *
 * ## Quem pode ver este link
 *
 * Só quem já administra aquela pessoa: pode trocar o papel dela, desligá-la,
 * ver o trabalho dela. O fluxo público de "esqueci minha senha" **nunca**
 * devolve o link — lá quem pede é anônimo, e devolvê-lo entregaria contas a
 * quem digitasse o endereço certo.
 */
import { useState } from "react";
import { Check, Copy, Mail, MailX, MessageCircle, Send } from "lucide-react";

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
import type { TeamPasswordLink } from "@/types/workforce";

export function PasswordLinkDialog({
  resultado,
  error,
  isPending,
  onOpenChange,
}: {
  resultado: TeamPasswordLink | null;
  error: Parameters<typeof MutationError>[0]["error"];
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const aberto = isPending || Boolean(resultado) || Boolean(error);
  const [copiado, setCopiado] = useState(false);

  if (!aberto) return null;

  const copiar = async () => {
    if (!resultado) return;
    try {
      await navigator.clipboard.writeText(resultado.link);
      setCopiado(true);
    } catch {
      /* Sem área de transferência: o link está na tela para ser selecionado. */
    }
  };

  const mensagem = resultado
    ? `Olá! Use este link para definir sua senha do Orbit: ${resultado.link}`
    : "";

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
          <DialogTitle>Link de definição de senha</DialogTitle>
          <DialogDescription>
            {resultado
              ? `Para ${resultado.member.displayName}. Vale até ${formatDateTime(
                  resultado.expiresAt,
                )} e serve uma única vez.`
              : "Gerando…"}
          </DialogDescription>
        </DialogHeader>

        <MutationError error={error} />

        {resultado ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p
                className="break-all font-mono text-xs"
                data-testid="password-link"
              >
                {resultado.link}
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

              {/*
                `noreferrer` junto de `noopener`: o destino é um aplicativo de
                mensagens de terceiro, e não há motivo para contar a ele de que
                página o link saiu.
              */}
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
                    resultado.link,
                  )}&text=${encodeURIComponent(
                    "Link para definir sua senha do Orbit",
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
              {resultado.emailSent ? (
                <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              ) : (
                <MailX className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              )}
              <span>
                {resultado.emailSent
                  ? `Também enviamos para ${resultado.member.email}.`
                  : "O envio por e-mail não saiu — repasse o link por aqui."}
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
