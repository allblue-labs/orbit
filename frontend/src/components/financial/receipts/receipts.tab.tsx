"use client";

/**
 * Recibos — os emitidos e a emissão de novos.
 *
 * ## Por que os recibos moram no Financeiro
 *
 * Recibo é dinheiro recebido: quando a emissão é publicada, ele **vira** lançamento
 * de receita confirmada, sozinho. A aba fica ao lado de onde esse lançamento
 * aparece.
 *
 * ## A lista é a das execuções, recortada pelo tipo
 *
 * Um recibo é uma execução de artefato do tipo `RECIBO`, e o filtro é do servidor
 * (`artifactType`) — pelo **snapshot**, não pelo template: o tipo do documento
 * emitido é o que ficou congelado nele, e um template renomeado depois não reescreve
 * o que já saiu. Uma listagem própria de recibos seria uma segunda verdade sobre as
 * mesmas linhas.
 *
 * ## O valor não aparece aqui
 *
 * Ele está no documento e no lançamento que a emissão gera. Repeti-lo na lista
 * exigiria ler as respostas de cada execução — uma consulta por linha — para
 * mostrar um número que a aba de Lançamentos já mostra, com o estado de confirmação
 * que só ela conhece.
 */
import { useState } from "react";
import { FileText, Plus } from "lucide-react";
import Link from "next/link";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RenderStatusBadge } from "@/documents/document-components";
import { useArtifactExecutionsList } from "@/hooks/artifact-executions/use-artifact-executions";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import { useActiveScope } from "@/providers/use-active-scope";
import { ReceiptWizardDialog } from "./receipt-wizard.dialog";

/** O tipo de artefato que representa dinheiro recebido. */
const RECEIPT_TYPE = "RECIBO";

export function FinancialReceiptsTab() {
  const { formatDateTime } = useDateFormatters();
  const session = useSession();
  const { businessUnitId } = useActiveScope();
  const [wizardOpen, setWizardOpen] = useState(false);

  const canIssue = session.hasPermission("financial.manage");

  const receipts = useArtifactExecutionsList({
    artifactType: RECEIPT_TYPE,
    businessUnitId: businessUnitId ?? undefined,
    page: 1,
    limit: 20,
  });

  return (
    <PanelFrame
      panelId="financial-receipts"
      title="Recibos"
      description="Comprovantes de pagamento recebido. Emitir publica o documento e lança a receita."
      actions={
        canIssue ? (
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="size-4" />
            Novo recibo
          </Button>
        ) : null
      }
    >
      <PanelState
        query={toPanelQuery(receipts)}
        loadingRows={4}
        isEmpty={(page) => page.data.length === 0}
        emptyMessage="Nenhum recibo emitido. Um recibo pode nascer de um serviço executado ou do zero — adiantamento, acerto, peça vendida no balcão."
      >
        {(page) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Número</TableHead>
                <TableHead>Recebemos de</TableHead>
                <TableHead>Emissão</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.data.map((receipt) => {
                return (
                  <TableRow key={receipt.id}>
                    <TableCell className="font-mono text-xs">
                      {receipt.code}
                    </TableCell>
                    {/* O título do recibo carrega o pagador: é assim que ele é
                        montado na emissão, e é o que se procura numa lista. */}
                    <TableCell className="max-w-64 truncate text-sm">
                      {receipt.title}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {formatDateTime(receipt.createdAt)}
                    </TableCell>
                    <TableCell>
                      {/*
                       * O selo é o mesmo do detalhe do recibo e da central de
                       * documentos.
                       *
                       * Havia aqui um mapa próprio que chamava o estado pronto
                       * de `COMPLETED` — e o motor o chama de `READY`. Todo
                       * recibo emitido caía no padrão e aparecia como
                       * "Rascunho", enquanto a página dele dizia "Emitido".
                       */}
                      <RenderStatusBadge status={receipt.renderStatus} />
                    </TableCell>
                    <TableCell>
                      {/* Abrir leva à execução, que é onde o documento se
                          renderiza, se baixa e se publica — e publicar é o que
                          lança a receita. */}
                      <Button asChild variant="ghost" size="icon">
                        <Link
                          href={`${ROUTES.executions}/${receipt.id}`}
                          aria-label={`Abrir recibo ${receipt.code}`}
                        >
                          <FileText className="size-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </PanelState>

      <ReceiptWizardDialog open={wizardOpen} onOpenChange={setWizardOpen} />
    </PanelFrame>
  );
}
