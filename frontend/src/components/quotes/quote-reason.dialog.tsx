"use client";

/**
 * O motivo de encerrar uma proposta.
 *
 * Recusa e cancelamento **exigem** motivo no contrato — mínimo de três
 * caracteres. Um "tem certeza?" mandaria uma requisição que voltaria 400, então
 * o campo é o diálogo, não um passo depois dele.
 *
 * Mora em arquivo próprio porque dois lugares o abrem: a proposta aberta
 * (`QuoteActions`) e a linha da lista (`QuoteRowActions`). Em duas cópias, o
 * mínimo de três caracteres divergiria na primeira vez que alguém mexesse numa
 * delas, e um dos caminhos passaria a mandar pedido que o servidor recusa.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function QuoteReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  destructive = false,
  isPending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  isPending: boolean;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(reason.trim());
          }}
          className="space-y-5"
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="quote-reason">Motivo</Label>
            <Textarea
              id="quote-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Ex.: preço acima do orçamento disponível do cliente"
              required
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Voltar
            </Button>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={reason.trim().length < 3 || isPending}
            >
              {isPending ? "Registrando…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
