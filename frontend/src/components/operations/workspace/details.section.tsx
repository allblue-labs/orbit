"use client";

/**
 * Detalhes gerais, cliente, ativo e agenda da operação.
 *
 * Tudo vem de `GET /operations/:id` — uma única leitura já traz unidade,
 * cliente e ativo aninhados, então estas seções compartilham a mesma query e
 * não geram chamadas extras.
 */
import { Building2, DoorOpen, MapPin, User, Wrench } from "lucide-react";
import type { ReactNode } from "react";

import { PanelFrame, PanelState, type PanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/formatters";
import type { Operation } from "@/types/operations";
import {
  operationKindLabel,
  operationPriorityLabel,
} from "../operation-badges";

export function DetailsSection({ query }: { query: PanelQuery<Operation> }) {
  return (
    <PanelFrame
      panelId="operation-details"
      title="Detalhes"
      description="Informações gerais da operação"
    >
      <PanelState query={query} loadingRows={4}>
        {(operation) => (
          <div className="space-y-5">
            <dl className="grid gap-4 sm:grid-cols-2">
              {/*
                Número da OS e código são coisas diferentes, e aparecem os dois.

                O número é a contagem própria das ordens de serviço — o que sai no
                documento e o que o cliente cita. O código é o texto interno, que
                muitas organizações usam para amarrar com o sistema anterior.
                Mostrar um no lugar do outro faria alguém procurar pelo que não vê.
              */}
              {operation.serviceOrderCode ? (
                <Field label="Ordem de serviço">
                  <span className="font-mono">{operation.serviceOrderCode}</span>
                </Field>
              ) : null}
              <Field label="Código">
                <span className="font-mono">{operation.code}</span>
              </Field>
              <Field label="Tipo">{operationKindLabel(operation.kind)}</Field>
              <Field label="Prioridade">
                {operationPriorityLabel(operation.priority)}
              </Field>
              <Field label="Unidade">
                {operation.businessUnit.tradeName ??
                  operation.businessUnit.legalName}
              </Field>
            </dl>
            {operation.description ? (
              <div className="space-y-1 border-t border-border pt-4">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Descrição
                </p>
                <p className="text-sm whitespace-pre-wrap">
                  {operation.description}
                </p>
              </div>
            ) : null}
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

export function RelationsSection({ query }: { query: PanelQuery<Operation> }) {
  return (
    <PanelFrame
      panelId="operation-relations"
      title="Cliente e ativo"
      description="Vínculos da operação"
    >
      <PanelState query={query} loadingRows={3}>
        {(operation) => (
          <div className="space-y-4">
            <RelationRow
              icon={<User className="size-4" />}
              label="Cliente"
              value={
                operation.customer
                  ? (operation.customer.tradeName ??
                    operation.customer.legalName)
                  : null
              }
            />
            <RelationRow
              icon={<Wrench className="size-4" />}
              label={
                operation.assets.length > 1 ? "Equipamentos" : "Equipamento"
              }
              value={
                operation.assets.length > 0
                  ? operation.assets
                      .map((equipamento) => equipamento.name)
                      .join(", ")
                  : null
              }
              detail={
                operation.assets.length > 0 ? (
                  <span className="flex flex-wrap items-center gap-2">
                    {operation.assets.map((equipamento) => (
                      <span
                        key={equipamento.id}
                        className="flex items-center gap-1"
                      >
                        {equipamento.identifier ? (
                          <span className="font-mono text-xs">
                            {equipamento.identifier}
                          </span>
                        ) : null}
                        <Badge variant="outline">{equipamento.status}</Badge>
                      </span>
                    ))}
                  </span>
                ) : null
              }
            />

            {/*
              Para onde o técnico foi, e o ponto exato dentro do endereço.

              O atendimento dizia só a unidade de negócio — que é de quem
              atende, não de onde o serviço acontece.
            */}
            {operation.customerAddress ? (
              <RelationRow
                icon={<MapPin className="size-4" />}
                label="Endereço do atendimento"
                value={operation.customerAddress.label}
                detail={
                  <span className="text-xs text-muted-foreground">
                    {[
                      [
                        operation.customerAddress.street,
                        operation.customerAddress.number,
                      ]
                        .filter(Boolean)
                        .join(", "),
                      operation.customerAddress.district,
                      [
                        operation.customerAddress.city,
                        operation.customerAddress.stateCode,
                      ]
                        .filter(Boolean)
                        .join("/"),
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                  </span>
                }
              />
            ) : null}

            {operation.sector ? (
              <RelationRow
                icon={<DoorOpen className="size-4" />}
                label="Setor"
                value={operation.sector}
              />
            ) : null}
            <RelationRow
              icon={<Building2 className="size-4" />}
              label="Unidade"
              value={
                operation.businessUnit.tradeName ??
                operation.businessUnit.legalName
              }
            />
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

/**
 * Agenda da operação.
 *
 * Usa os campos de agendamento da própria operação. O módulo de scheduling
 * não permite filtrar eventos por operação (`EventQueryDto` não aceita
 * `operationId`), então não há como listar compromissos vinculados sem
 * inventar o vínculo.
 */
export function ScheduleSection({ query }: { query: PanelQuery<Operation> }) {
  return (
    <PanelFrame
      panelId="operation-schedule"
      title="Agenda"
      description="Janelas previstas e execução real"
    >
      <PanelState query={query} loadingRows={3}>
        {(operation) => (
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Início previsto">
              {formatDateTime(operation.scheduledStart)}
            </Field>
            <Field label="Término previsto">
              {formatDateTime(operation.scheduledEnd)}
            </Field>
            <Field label="Início real">
              {formatDateTime(operation.startedAt)}
            </Field>
            <Field label="Conclusão">
              {formatDateTime(operation.completedAt)}
            </Field>
          </dl>
        )}
      </PanelState>
    </PanelFrame>
  );
}

/**
 * Campos livres (`location` e `data`).
 *
 * O backend guarda ambos como JSON sem esquema — o que o tenant gravou é o
 * que aparece, sem interpretação do frontend.
 */
export function AdditionalDataSection({
  query,
}: {
  query: PanelQuery<Operation>;
}) {
  return (
    <PanelFrame
      panelId="operation-additional"
      title="Informações adicionais"
      description="Campos livres da organização"
    >
      <PanelState
        query={query}
        loadingRows={2}
        emptyMessage="Nenhuma informação adicional registrada."
        isEmpty={(operation) =>
          !hasContent(operation.location) && !hasContent(operation.data)
        }
      >
        {(operation) => (
          <div className="space-y-4">
            <JsonBlock label="Localização" value={operation.location} />
            <JsonBlock label="Dados" value={operation.data} />
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

function hasContent(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value as Record<string, unknown>).length > 0
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (!hasContent(value)) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <pre className="glass max-h-56 overflow-auto rounded-lg p-3 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function RelationRow({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string | null;
  detail?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-strong text-primary">
        {icon}
      </span>
      <div className="min-w-0 space-y-0.5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="truncate text-sm">{value ?? "Não vinculado"}</p>
        {detail}
      </div>
    </div>
  );
}
