"use client";

/**
 * Detalhe de um lançamento.
 *
 * Painel lateral, não página: são doze campos, e o Entity Registry declara
 * `href: () => ROUTES.financial` justamente porque não existe rota por
 * lançamento.
 *
 * ## Procedência em primeiro plano
 *
 * A origem é a informação que muda o que se pode fazer com o registro, então
 * ela aparece antes dos valores — e, quando é automática, explica de onde o
 * número veio. Um lançamento de recibo com o mesmo aspecto de um manual
 * convidaria alguém a tentar corrigi-lo aqui em vez de corrigir o documento.
 *
 * ## Referências
 *
 * Cliente e operação viram links pelo **Entity Registry**; nenhuma URL é
 * montada à mão. O **documento** que originou o lançamento é a lacuna: o
 * `origin.entityId` é o id do `ArtifactManifest`, e o Document Center não tem
 * rota por manifesto — a navegação dele é por execução. O painel mostra a
 * referência e diz que não há para onde ir, em vez de inventar um caminho que
 * daria 404.
 */
import { Receipt } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAction } from "@/actions";
import { EntityBadge, EntityLink } from "@/entities";
import { formatDateTime } from "@/lib/formatters";
import {
  FINANCIAL_SOURCE_DESCRIPTIONS,
  type FinancialEntry,
} from "@/types/financial";
import { CompetenceDate, Money, OverdueMark } from "./financial-presentation";

export function FinancialEntrySheet({
  entry,
  onOpenChange,
  onEdit,
  onConfirm,
  onCancel,
}: {
  entry: FinancialEntry | null;
  onOpenChange: (open: boolean) => void;
  onEdit: (entry: FinancialEntry) => void;
  onConfirm: (entry: FinancialEntry) => void;
  onCancel: (entry: FinancialEntry) => void;
}) {
  return (
    <Sheet open={entry !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {entry ? (
          <Body
            entry={entry}
            onEdit={onEdit}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({
  entry,
  onEdit,
  onConfirm,
  onCancel,
}: {
  entry: FinancialEntry;
  onEdit: (entry: FinancialEntry) => void;
  onConfirm: (entry: FinancialEntry) => void;
  onCancel: (entry: FinancialEntry) => void;
}) {
  const edit = useAction("financial-entry.update");
  const confirm = useAction("financial-entry.confirm");
  const cancel = useAction("financial-entry.cancel");

  /**
   * `editable` é do servidor.
   *
   * Ele já combina origem e situação — manual e não cancelado. Repetir a
   * condição aqui criaria uma segunda regra, que divergiria da primeira assim
   * que o backend passasse a permitir editar algo mais.
   */
  const canEdit = edit.allowed && entry.editable;
  const canConfirm = confirm.allowed && entry.status === "PENDING";
  const canCancel = cancel.allowed && entry.status !== "CANCELLED";

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex flex-wrap items-center gap-2">
          {entry.description}
          <EntityBadge
            entity="financial-entry"
            group="status"
            value={entry.status}
          />
          <OverdueMark overdue={entry.isOverdue} />
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <EntityBadge
            entity="financial-entry"
            group="type"
            value={entry.type}
          />
          <EntityBadge
            entity="financial-entry"
            group="source"
            value={entry.origin.source}
          />
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        <div className="glass-panel rounded-xl p-4">
          <p className="text-xs text-muted-foreground">Valor</p>
          <p className="font-display text-3xl font-bold">
            <Money value={entry.amount} type={entry.type} signed />
          </p>
          <p className="text-xs text-muted-foreground">{entry.currency}</p>
        </div>

        {entry.origin.source === "MANUAL" ? null : (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Receipt className="size-4 text-sky-400" aria-hidden />
              Lançamento automático
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {FINANCIAL_SOURCE_DESCRIPTIONS[entry.origin.source] ??
                "Gerado pela plataforma a partir de outro registro."}{" "}
              O valor não é editável aqui — corrija o documento de origem. Se
              ele não vale mais, cancele este lançamento.
            </p>
            {entry.origin.entityId ? (
              <p className="mt-2 font-mono text-[11px] break-all text-muted-foreground">
                Documento de origem: {entry.origin.entityId}
                <span className="block font-sans">
                  Não há rota por documento emitido — a navegação do Document
                  Center é por execução.
                </span>
              </p>
            ) : null}
          </div>
        )}

        <dl className="space-y-3 text-sm">
          <Row label="Competência">
            <CompetenceDate value={entry.competenceDate} />
          </Row>
          <Row label="Vencimento">
            {entry.dueDate ? (
              <CompetenceDate value={entry.dueDate} />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label="Categoria">
            {entry.category ? (
              entry.category.name
            ) : (
              <span className="text-muted-foreground">Sem categoria</span>
            )}
          </Row>
          <Row label="Organização">{entry.businessUnit.name}</Row>
          <Row label="Cliente">
            {entry.customer ? (
              <EntityLink entity="customer" id={entry.customer.id}>
                {entry.customer.displayName}
              </EntityLink>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          <Row label="Operação">
            {entry.operation ? (
              <EntityLink entity="operation" id={entry.operation.id}>
                {entry.operation.code} · {entry.operation.title}
              </EntityLink>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </Row>
          {entry.notes ? (
            <Row label="Observações">{entry.notes}</Row>
          ) : null}
        </dl>

        <div className="space-y-3 border-t border-border pt-4 text-sm">
          <Row label="Lançado por">
            {entry.createdBy.displayName} · {formatDateTime(entry.createdAt)}
          </Row>
          {entry.confirmedAt ? (
            <Row label="Confirmado por">
              {entry.confirmedBy?.displayName ?? "—"} ·{" "}
              {formatDateTime(entry.confirmedAt)}
            </Row>
          ) : null}
          {entry.cancelledAt ? (
            <Row label="Cancelado por">
              <span className="block">
                {entry.cancelledBy?.displayName ?? "—"} ·{" "}
                {formatDateTime(entry.cancelledAt)}
              </span>
              {entry.cancelReason ? (
                <span className="block text-muted-foreground">
                  {entry.cancelReason}
                </span>
              ) : null}
            </Row>
          ) : null}
        </div>

        {canEdit || canConfirm || canCancel ? (
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            {canConfirm ? (
              <Button size="sm" onClick={() => onConfirm(entry)}>
                {confirm.label}
              </Button>
            ) : null}
            {canEdit ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onEdit(entry)}
              >
                {edit.label}
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                onClick={() => onCancel(entry)}
              >
                {cancel.label}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
