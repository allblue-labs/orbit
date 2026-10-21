"use client";

import type { ReactNode } from "react";
import { useAssetsList } from "@/hooks/assets/use-assets";
import { useCustomerAddresses } from "@/hooks/customers/use-customers";
import {
  useFieldAssistants,
  useFieldTechnicians,
} from "@/hooks/workforce/use-workforce";
import { operationKindLabel, operationPriorityLabel } from "./operation-badges";
import {
  operationInstant,
  parseOperationAmount,
  type OperationFormState,
} from "./operation-wizard.model";

export function OperationReviewStep({
  form,
  customerLabel,
  timeZone,
  unitLabel,
  hasChecklist,
}: {
  form: OperationFormState;
  customerLabel?: string;
  timeZone: string;
  unitLabel: string;
  hasChecklist: boolean;
}) {
  const addresses = useCustomerAddresses(form.customerId || null, true);
  const assets = useAssetsList(
    { customerId: form.customerId, limit: 100 },
    { enabled: Boolean(form.customerId) },
  );
  const scope = form.businessUnitId
    ? { businessUnitId: form.businessUnitId }
    : undefined;
  const technicians = useFieldTechnicians(scope, Boolean(form.responsibleId));
  const assistants = useFieldAssistants(scope, form.auxiliaryIds.length > 0);
  const address = addresses.data?.find(
    (item) => item.id === form.customerAddressId,
  );
  const amount = parseOperationAmount(form.manualAmount);
  const date = (local: string) => {
    const instant = operationInstant(local, timeZone);
    return instant
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone,
        }).format(new Date(instant))
      : "Não definido";
  };
  return (
    <div className="space-y-5">
      <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        Confira o atendimento. Você pode voltar a qualquer etapa para ajustar os
        dados.
      </p>
      <dl className="grid gap-4 sm:grid-cols-2">
        <Entry label="Cliente">
          {customerLabel || "Sem cliente vinculado"}
        </Entry>
        <Entry label="Unidade">{unitLabel}</Entry>
        <Entry label="Endereço">{address?.summary || "Não informado"}</Entry>
        <Entry label="Setor">{form.sector || "Não informado"}</Entry>
        <Entry label="Complemento">
          {address?.complement || "Não informado"}
        </Entry>
        <Entry label="Ponto de referência e acesso">
          {address?.notes || "Não informado"}
        </Entry>
        <Entry label="Título">{form.title}</Entry>
        <Entry label="Código">{form.code}</Entry>
        <Entry label="Tipo">{operationKindLabel(form.kind)}</Entry>
        <Entry label="Prioridade">
          {operationPriorityLabel(form.priority)}
        </Entry>
        <Entry label="Início previsto">{date(form.startLocal)}</Entry>
        <Entry label="Término previsto">{date(form.endLocal)}</Entry>
        <Entry label="Técnico operacional">
          {technicians.data?.find((person) => person.id === form.responsibleId)
            ?.name || (form.responsibleId ? "Selecionado" : "Definir depois")}
        </Entry>
        <Entry label="Auxiliares">
          {form.auxiliaryIds.length
            ? form.auxiliaryIds
                .map(
                  (id) =>
                    assistants.data?.find((person) => person.id === id)?.name ||
                    "Selecionado",
                )
                .join(", ")
            : "Nenhum"}
        </Entry>
        <Entry label="Equipamentos">
          {form.assetIds.length
            ? form.assetIds
                .map(
                  (id) =>
                    assets.data?.data.find((asset) => asset.id === id)?.name ||
                    "Selecionado",
                )
                .join(", ")
            : "Nenhum selecionado"}
        </Entry>
        <Entry label="Checklist">
          {hasChecklist
            ? "Modelo do tipo de atendimento"
            : "Sem modelo vinculado"}
          {form.checklistExtras.length
            ? ` · ${form.checklistExtras.length} item(ns) adicional(is)`
            : ""}
        </Entry>
        <Entry label="Valor do atendimento">
          {amount !== null && Number.isFinite(amount)
            ? new Intl.NumberFormat("pt-BR", {
                style: "currency",
                currency: "BRL",
              }).format(amount)
            : "Usar o orçamento vinculado"}
        </Entry>
        <Entry label="Valor no aplicativo">
          {form.amountVisibleInField
            ? "Visível para o técnico"
            : "Não exibir ao técnico"}
        </Entry>
        {form.description ? (
          <Entry label="Descrição">{form.description}</Entry>
        ) : null}
      </dl>
    </div>
  );
}

function Entry({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm whitespace-pre-wrap">
        {children}
      </dd>
    </div>
  );
}
