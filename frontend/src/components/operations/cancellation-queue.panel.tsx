"use client";

/**
 * Os pedidos de cancelamento que o campo devolveu.
 *
 * ## Por que esta tela existe
 *
 * O técnico na porta descobre que não dá para atender e registra o motivo. Isso
 * precisa de desfecho para ele — e nenhuma autoridade para encerrar o compromisso:
 * cancelar é decisão comercial. Sem este lugar, o relato ficaria num registro que
 * ninguém abre, e o atendimento continuaria marcado para um dia em que já se sabe
 * que não vai acontecer.
 *
 * ## Quatro desfechos, e nenhum deles é "ignorar"
 *
 * Remarcar, trocar o técnico, cancelar ou manter como está. O último é uma
 * **resposta**: o técnico precisa saber que foi lido e que o atendimento continua de
 * pé. Fechar a aba sem decidir não é desfecho nenhum.
 *
 * ## Resolver é separado de agir
 *
 * O botão registra a decisão aqui e leva o dono ao atendimento para executá-la, nas
 * telas que já sabem remarcar e reatribuir — com o histórico e as validações delas.
 * Duplicar essas ações dentro deste painel criaria um segundo caminho para alterar
 * atendimento, e os dois divergiriam na primeira regra nova.
 *
 * A ordem importa: resolver primeiro fecha a janela em que dois donos decidem o
 * mesmo pedido.
 */
import { useState } from "react";
import { CalendarClock, CircleSlash, UserCog, Check } from "lucide-react";

import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EntityLink } from "@/entities/entity-components";
import {
  useOperationCancellationRequests,
  useResolveOperationCancellation,
} from "@/hooks/operations/use-operations";
import { formatDateTime } from "@/lib/formatters";
import type {
  OperationCancellationDecision,
  OperationCancellationRequest,
} from "@/types/operations";
import { ListState } from "@/workspace";

/**
 * O que cada desfecho significa, e o que acontece depois dele.
 *
 * `followUp` é o que o dono ainda precisa fazer no atendimento — a decisão fica
 * registrada aqui, e a ação acontece lá. Nulo quando não há o que fazer.
 */
const DESFECHOS: Readonly<
  Record<
    OperationCancellationDecision,
    {
      label: string;
      icon: typeof CalendarClock;
      body: string;
      followUp: string | null;
      destructive?: boolean;
    }
  >
> = {
  RESCHEDULED: {
    label: "Remarcar",
    icon: CalendarClock,
    body: "O pedido é encerrado como remarcado. Abra o atendimento em seguida para escolher a nova data — é lá que a mudança é registrada no histórico.",
    followUp: "Defina a nova data no atendimento.",
  },
  REASSIGNED: {
    label: "Trocar o técnico",
    icon: UserCog,
    body: "O pedido é encerrado como reatribuído. Abra o atendimento em seguida para escolher quem vai no lugar.",
    followUp: "Escolha o novo Técnico Operacional no atendimento.",
  },
  DISMISSED: {
    label: "Manter como está",
    icon: Check,
    body: "O atendimento continua de pé, na mesma data e com o mesmo técnico. O pedido é encerrado como lido.",
    followUp: null,
  },
  CANCELLED: {
    label: "Cancelar o atendimento",
    icon: CircleSlash,
    body: "O pedido é encerrado como cancelado. Abra o atendimento em seguida para registrar o cancelamento — é o que muda o estado dele.",
    followUp: "Registre o cancelamento no atendimento.",
    destructive: true,
  },
};

export function CancellationQueuePanel({ enabled = true }: { enabled?: boolean }) {
  const fila = useOperationCancellationRequests("PENDING", enabled);
  const resolver = useResolveOperationCancellation();

  /** Qual pedido e qual desfecho esperam confirmação. Nada dispara sem passar aqui. */
  const [pendente, setPendente] = useState<{
    request: OperationCancellationRequest;
    decision: OperationCancellationDecision;
  } | null>(null);
  const [observacao, setObservacao] = useState("");

  const escolha = pendente ? DESFECHOS[pendente.decision] : null;

  return (
    <PanelFrame
      panelId="operations-cancellation-queue"
      title="Pedidos de cancelamento"
      description="O que o campo devolveu, esperando a sua decisão."
    >
      <ListState
        isPending={fila.isPending}
        error={fila.error}
        items={fila.data ?? []}
        empty={{
          title: "Nenhum pedido em aberto",
          description:
            "Quando alguém em campo não conseguir atender, o relato aparece aqui.",
        }}
        onRetry={() => void fila.refetch()}
      >
        {(pedidos) => (
          <div className="space-y-3">
            {pedidos.map((pedido) => (
              <Linha
                key={pedido.id}
                pedido={pedido}
                onEscolher={(decision) => {
                  setObservacao("");
                  setPendente({ request: pedido, decision });
                }}
              />
            ))}
          </div>
        )}
      </ListState>

      <ConfirmDialog
        open={pendente !== null}
        onOpenChange={(open) => {
          if (!open) setPendente(null);
        }}
        title={escolha?.label ?? ""}
        body={escolha?.body}
        confirmLabel={escolha?.label ?? "Confirmar"}
        isPending={resolver.isPending}
        error={resolver.error}
        onConfirm={() => {
          if (!pendente) return;
          resolver.mutate(
            {
              id: pendente.request.id,
              resolution: pendente.decision,
              notes: observacao.trim() || undefined,
            },
            { onSuccess: () => setPendente(null) },
          );
        }}
      >
        {/* A resposta ao técnico. Opcional — o desfecho já diz o essencial, e
            exigir texto faria o dono escrever "ok" para fechar a janela. */}
        <Textarea
          value={observacao}
          onChange={(event) => setObservacao(event.target.value)}
          placeholder="Resposta ao técnico (opcional)"
          rows={3}
          maxLength={2000}
        />
        {escolha?.followUp ? (
          <p className="text-xs text-muted-foreground">{escolha.followUp}</p>
        ) : null}
      </ConfirmDialog>
    </PanelFrame>
  );
}

function Linha({
  pedido,
  onEscolher,
}: {
  pedido: OperationCancellationRequest;
  onEscolher: (decision: OperationCancellationDecision) => void;
}) {
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <EntityLink entity="operation" id={pedido.operation.id}>
            {pedido.operation.code} · {pedido.operation.title}
          </EntityLink>
          <p className="text-xs text-muted-foreground">
            {[
              pedido.operation.customerName,
              pedido.operation.scheduledStart
                ? formatDateTime(pedido.operation.scheduledStart)
                : "sem data",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <Badge variant="outline">
          {pedido.requestedBy.displayName} ·{" "}
          {formatDateTime(pedido.requestedAt)}
        </Badge>
      </div>

      {/* A justificativa é o que o dono lê para decidir, então ela vem inteira
          e em destaque — não truncada numa linha de tabela. */}
      <p className="mt-2 whitespace-pre-wrap text-sm">{pedido.reason}</p>

      {pedido.evidence.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          {pedido.evidence.length === 1
            ? "1 foto anexada"
            : `${pedido.evidence.length} fotos anexadas`}{" "}
          — veja no atendimento.
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {(
          Object.keys(DESFECHOS) as OperationCancellationDecision[]
        ).map((decision) => {
          const desfecho = DESFECHOS[decision];
          const Icone = desfecho.icon;
          return (
            <Button
              key={decision}
              type="button"
              size="sm"
              variant={desfecho.destructive ? "outline" : "secondary"}
              className={
                desfecho.destructive
                  ? "text-destructive hover:text-destructive"
                  : undefined
              }
              onClick={() => onEscolher(decision)}
            >
              <Icone className="size-3.5" />
              {desfecho.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** Exportado para o teste do mapa de desfechos. */
export { DESFECHOS as CANCELLATION_OUTCOMES };
