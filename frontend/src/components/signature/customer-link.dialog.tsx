"use client";
import { useState } from "react";
import { Copy, Check, MessageCircle, ExternalLink } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import { MutationError } from "@/components/artifact-studio/mutation-error";
export function CustomerLinkDialog({
  result,
  error,
  pending,
  onClose,
}: {
  result: { token: string; code: string; expiresAt: string } | null;
  error: Parameters<typeof MutationError>[0]["error"];
  pending: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { formatDateTime } = useDateFormatters();
  const url =
    result && typeof window !== "undefined"
      ? `${window.location.origin}/proposta/${encodeURIComponent(result.token)}`
      : "";
  const message = `Olá! Segue o orçamento ${result?.code ?? ""} para leitura, download e aprovação: ${url}`;
  return (
    <Dialog
      open={pending || Boolean(result) || Boolean(error)}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar orçamento para aprovação</DialogTitle>
          <DialogDescription>
            {result
              ? `Orçamento ${result.code}. Link válido até ${formatDateTime(result.expiresAt)}.`
              : "Preparando a proposta para o cliente…"}
          </DialogDescription>
        </DialogHeader>
        <MutationError error={error} />
        {result ? (
          <div className="space-y-4">
            <Input
              aria-label="Link de aprovação do orçamento"
              readOnly
              value={url}
              onFocus={(event) => event.target.select()}
            />
            <div className="grid gap-2 sm:grid-cols-3">
              <Button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                {copied ? <Check /> : <Copy />}
                {copied ? "Copiado" : "Copiar link"}
              </Button>
              <Button variant="outline" asChild>
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(message)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MessageCircle />
                  WhatsApp
                </a>
              </Button>
              <Button variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Conferir
                </a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              O cliente pode baixar a proposta, aprovar com assinatura, recusar
              ou pedir alterações. Ao gerar outro link, o anterior pendente
              deixa de funcionar.
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
