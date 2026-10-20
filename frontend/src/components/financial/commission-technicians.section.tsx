"use client";

/**
 * O fechamento: quem tem comissão a receber na janela.
 *
 * ## Uma tabela, não cartões
 *
 * A pergunta é comparativa — "quem tenho a pagar, e quanto?" — e comparar
 * números é o que uma tabela faz. Cartão por técnico obrigaria a percorrer a
 * página somando de cabeça.
 *
 * ## "Detalhes" leva à página da pessoa
 *
 * E não a uma página só de comissão: quem confere um pagamento costuma querer
 * ver a carga, o perfil e as certificações da mesma pessoa. A página do membro
 * tem a comissão dentro, com o histórico completo.
 *
 * ## Pagar todas é o caminho principal
 *
 * No fechamento, o ato é "pagar o que este técnico tem". Pagar uma comissão
 * avulsa e pagar as marcadas existem porque acontecem — um adiantamento, uma
 * correção —, mas ficam na página do técnico, onde as comissões estão listadas
 * uma a uma. Aqui o botão paga a janela inteira daquela pessoa.
 */
import { useState } from "react";
import { ArrowRight, Wallet } from "lucide-react";
import Link from "next/link";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCommissionOverview,
  usePayCommissions,
} from "@/hooks/commissions/use-commissions";
import { COMMISSION_PERIOD_LABELS } from "@/types/commissions";
import type { CommissionSummary } from "@/types/commissions";
import { FORMATTERS } from "@/metrics";
import { formatDate } from "@/lib/formatters";
import { teamMemberRoute } from "@/lib/routes";

export function CommissionTechniciansSection({
  canManage,
}: {
  canManage: boolean;
}) {
  const overview = useCommissionOverview();
  const pay = usePayCommissions();
  const [pagando, setPagando] = useState<string | null>(null);

  if (overview.isPending) {
    return (
      <PanelFrame
        panelId="commission-technicians"
        title="Comissão por técnico"
        description="Carregando o fechamento"
      >
        <PanelLoading rows={4} />
      </PanelFrame>
    );
  }

  if (overview.error) {
    return (
      <PanelFrame
        panelId="commission-technicians"
        title="Comissão por técnico"
        description="O que há a pagar na janela"
      >
        <PanelError
          error={overview.error}
          onRetry={() => void overview.refetch()}
        />
      </PanelFrame>
    );
  }

  const dados = overview.data;
  const janela = dados
    ? `${formatDate(dados.window.from)} a ${formatDate(dados.window.to)}`
    : "";

  const pagarTudo = (userId: string) => {
    setPagando(userId);
    pay.mutate({ userId }, { onSettled: () => setPagando(null) });
  };

  return (
    <PanelFrame
      panelId="commission-technicians"
      title="Comissão por técnico"
      description={
        dados
          ? `${COMMISSION_PERIOD_LABELS[dados.window.period]} · ${janela}`
          : "O que há a pagar na janela"
      }
      actions={
        dados ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">A pagar</span>
            <span className="font-mono font-semibold tabular-nums">
              {FORMATTERS.currency(dados.pendingTotal)}
            </span>
            <span className="text-muted-foreground">· pago</span>
            <span className="font-mono tabular-nums text-muted-foreground">
              {FORMATTERS.currency(dados.paidTotal)}
            </span>
          </div>
        ) : null
      }
    >
      <div className="space-y-3">
        {dados?.inactiveReason ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {dados.inactiveReason} Os técnicos continuam listados com a carga de
            trabalho.
          </p>
        ) : null}

        <MutationError error={pay.error} />

        {(dados?.technicians.length ?? 0) === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            Nenhum técnico de campo cadastrado. O perfil profissional de cada
            pessoa define quem é técnico.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Técnico</TableHead>
                  <TableHead className="text-right">A pagar</TableHead>
                  <TableHead className="text-right">Pago na janela</TableHead>
                  <TableHead className="text-right">Atendimentos</TableHead>
                  <TableHead className="text-right">Em andamento</TableHead>
                  <TableHead className="text-right">Execuções</TableHead>
                  <TableHead className="w-40" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados?.technicians.map((linha) => (
                  <Row
                    key={linha.userId}
                    row={linha}
                    canManage={canManage}
                    paying={pagando === linha.userId && pay.isPending}
                    onPayAll={() => pagarTudo(linha.userId)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          A comissão aparece quando o atendimento é concluído
          {dados?.policy.requiresConfirmedRevenue
            ? " e a receita dele é confirmada"
            : ""}
          . Pagar registra o valor congelado: mudar a configuração depois não
          altera o que já foi pago.
        </p>
      </div>
    </PanelFrame>
  );
}

function Row({
  row,
  canManage,
  paying,
  onPayAll,
}: {
  row: CommissionSummary;
  canManage: boolean;
  paying: boolean;
  onPayAll: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0">
          <p className="truncate font-medium">{row.userName ?? row.userId}</p>
          <p className="truncate text-xs text-muted-foreground">
            {row.roleName ?? "—"}
            {row.membershipStatus && row.membershipStatus !== "ACTIVE" ? (
              <Badge variant="outline" className="ml-2 text-[10px]">
                {row.membershipStatus.toLowerCase()}
              </Badge>
            ) : null}
          </p>
        </div>
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums">
        {row.pendingAmount > 0 ? (
          <span className="font-semibold">
            {FORMATTERS.currency(row.pendingAmount)}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {row.pendingCount > 0 ? (
          <span className="ml-1 text-xs text-muted-foreground">
            ({row.pendingCount})
          </span>
        ) : null}
      </TableCell>

      <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
        {row.paidAmount > 0 ? FORMATTERS.currency(row.paidAmount) : "—"}
      </TableCell>

      <TableCell className="text-right tabular-nums">
        {row.assignedOperations}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.operationsInProgress}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.executionsResponsible}
        {row.executionsInProgress > 0 ? (
          <span className="ml-1 text-xs text-muted-foreground">
            ({row.executionsInProgress} em andamento)
          </span>
        ) : null}
      </TableCell>

      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {canManage && row.pendingAmount > 0 ? (
            <Button size="sm" disabled={paying} onClick={onPayAll}>
              <Wallet className="size-4" />
              {paying ? "Pagando…" : "Pagar"}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" asChild>
            <Link href={teamMemberRoute(row.userId)}>
              Detalhes
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
