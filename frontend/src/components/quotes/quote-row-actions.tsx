"use client";

/**
 * As ações da linha: baixar, aprovar, cancelar.
 *
 * ## Três, e não as cinco da proposta aberta
 *
 * São as que se faz **percorrendo a lista**: imprimir para enviar, registrar o
 * "ok" que o cliente deu por telefone, e encerrar o que não vai andar. Recusa
 * exige o motivo do cliente e conversão escolhe tipo de serviço e prioridade —
 * decisões que pedem o contexto da proposta aberta, não um clique de passagem.
 * `QuoteActions` continua sendo o conjunto completo, na página.
 *
 * ## Botões, não três pontinhos
 *
 * A ação mais frequente aqui é baixar, e num menu ela custa dois cliques e uma
 * leitura. Com três ações cabendo na largura, o menu só esconderia o que a
 * pessoa vai usar.
 *
 * ## A máquina de estados não é reimplementada
 *
 * Cada botão depende de **duas** respostas: a sessão pode ver a ação (Action
 * Registry) e a proposta aceita a transição agora (`transitions`, do servidor).
 * Deduzir do status criaria uma segunda máquina de estados, e as duas
 * divergiriam no primeiro estado novo.
 *
 * Baixar não tem transição: imprimir não muda o estado de nada, e uma proposta
 * cancelada continua sendo um documento que alguém precisa arquivar.
 */
import { useState } from "react";
import { Check, FileDown, Loader2, Ban } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAction } from "@/actions";
import {
  useQuoteDocument,
  useQuoteTransition,
} from "@/hooks/quotes/use-quotes";
import type { QuoteSummary } from "@/types/quotes";
import { QuoteReasonDialog } from "./quote-reason.dialog";

export function QuoteRowActions({ quote }: { quote: QuoteSummary }) {
  const approveAction = useAction("quote.approve");
  const cancelAction = useAction("quote.cancel");

  const download = useQuoteDocument(quote.id);
  const transition = useQuoteTransition(quote.id);
  const [asking, setAsking] = useState(false);

  const canApprove = approveAction.allowed && quote.transitions.canApprove;
  const canCancel = cancelAction.allowed && quote.transitions.canCancel;

  return (
    /*
     * A linha inteira abre o painel; estes controles não devem abri-lo também.
     * Sem o `stopPropagation`, baixar um PDF abriria o resumo por cima.
     */
    <div
      className="flex items-center justify-end gap-1"
      onClick={(event) => event.stopPropagation()}
    >
      <IconButton
        label="Baixar o orçamento em PDF"
        busy={download.isPending}
        onClick={() => download.mutate(undefined)}
      >
        <FileDown className="size-4" />
      </IconButton>

      {canApprove ? (
        <IconButton
          label="O cliente aprovou"
          busy={transition.isPending}
          onClick={() => transition.mutate({ action: "approve" })}
        >
          <Check className="size-4" />
        </IconButton>
      ) : null}

      {canCancel ? (
        <IconButton
          label="Cancelar a proposta"
          destructive
          busy={false}
          onClick={() => setAsking(true)}
        >
          <Ban className="size-4" />
        </IconButton>
      ) : null}

      <QuoteReasonDialog
        open={asking}
        onOpenChange={setAsking}
        title={cancelAction.confirm?.title ?? "Cancelar esta proposta?"}
        description={
          cancelAction.confirm?.body ??
          "O motivo fica registrado. Uma proposta encerrada sem explicação é a informação comercial que mais falta seis meses depois."
        }
        confirmLabel={cancelAction.confirm?.confirmLabel ?? "Cancelar proposta"}
        destructive
        isPending={transition.isPending}
        onConfirm={(reason) =>
          transition.mutate(
            { action: "cancel", reason },
            { onSuccess: () => setAsking(false) },
          )
        }
      />
    </div>
  );
}

/**
 * Ícone com rótulo acessível.
 *
 * O `Tooltip` explica ao ver; o `aria-label` explica a quem não vê. Um botão só
 * com ícone e sem nome é um botão que o leitor de tela anuncia como "botão".
 */
function IconButton({
  label,
  busy,
  destructive = false,
  onClick,
  children,
}: {
  label: string;
  busy: boolean;
  destructive?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={label}
          disabled={busy}
          className={destructive ? "text-destructive" : undefined}
          onClick={onClick}
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
