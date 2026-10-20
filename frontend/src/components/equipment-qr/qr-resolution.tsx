"use client";

/**
 * O que aparece quando alguém lê a etiqueta.
 *
 * ## Resolver não é agir
 *
 * A leitura faz **uma** coisa: pede o contexto do equipamento ao servidor e
 * mostra o que ele devolveu, incluindo as ações que aquele usuário pode tomar.
 * Nada é criado, nada é iniciado. Um QR que abrisse um atendimento sozinho
 * transformaria um adesivo numa ordem de serviço — e qualquer pessoa com uma
 * câmera passaria a operar o sistema.
 *
 * ## Uma consulta
 *
 * `GET /assets/qr/:token` já traz equipamento, cliente, local, último
 * atendimento, contextos de PMOC e as ações permitidas. Buscar cliente,
 * equipamento e plano em separado para montar isso aqui reconstruiria no
 * navegador a decisão que o servidor tomou — e as duas divergiriam.
 *
 * ## Falha fechada, sem distinção
 *
 * Token inexistente, revogado, de outra organização ou de outra unidade dão a
 * **mesma** resposta do servidor: 404. A tela preserva isso. Diferenciar os
 * casos entregaria um oráculo para descobrir quais etiquetas existem.
 */
import { useState } from "react";
import { AlertCircle, ArrowRight, QrCode } from "lucide-react";
import Link from "next/link";

import { OperationFormDialog } from "@/components/operations/operation-form.dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useQrResolution,
  useServiceOrderPreparation,
} from "@/hooks/equipment-qr/use-equipment-qr";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import { fieldAction } from "@/registry";
import type { EquipmentFieldDetails } from "@/types/equipment-qr";

export function QrResolution({ token }: { token: string }) {
  const resolution = useQrResolution(token);

  if (resolution.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  /**
   * Uma frase só para toda recusa.
   *
   * O servidor não diz se o token não existe, se foi substituído ou se
   * pertence a outra unidade — e a tela não inventa a diferença.
   */
  if (resolution.error || !resolution.data) {
    return (
      <section
        className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-border p-8 text-center"
        aria-label="Etiqueta não reconhecida"
      >
        <QrCode className="size-6 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold">Etiqueta não reconhecida</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Este código não corresponde a nenhum equipamento disponível para você.
          Se a etiqueta foi substituída, use a nova.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href={ROUTES.assets}>Ir para equipamentos</Link>
        </Button>
      </section>
    );
  }

  return <ResolvedEquipment equipment={resolution.data} />;
}

function ResolvedEquipment({
  equipment,
}: {
  equipment: EquipmentFieldDetails;
}) {
  return (
    <div className="space-y-5">
      <header className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{equipment.name}</h2>
            <p className="font-mono text-xs text-muted-foreground">
              {equipment.code}
            </p>
          </div>
          <Badge
            variant="secondary"
            className={
              equipment.availability.active
                ? "border-none bg-emerald-500/15 text-emerald-400"
                : "border-none bg-surface-strong text-muted-foreground"
            }
          >
            {equipment.availability.active ? "Ativo" : "Inativo"}
          </Badge>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Cliente" value={equipment.customer?.name ?? "—"} />
          <Field label="Local" value={equipment.serviceLocation ?? "—"} />
          <Field label="Setor" value={equipment.sector ?? "—"} />
          <Field
            label="Tipo"
            value={[equipment.type, equipment.brand, equipment.model]
              .filter(Boolean)
              .join(" · ")}
          />
        </dl>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <ContextPanel equipment={equipment} />
        <ActionsPanel equipment={equipment} />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate">{value || "—"}</dd>
    </div>
  );
}

function ContextPanel({ equipment }: { equipment: EquipmentFieldDetails }) {
  return (
    <section
      className="space-y-4 rounded-xl border border-border p-4"
      aria-label="Contexto operacional"
    >
      <h3 className="text-sm font-semibold">Contexto operacional</h3>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Field
          label="Último atendimento"
          value={
            equipment.lastService
              ? formatDateTime(String(equipment.lastService.date))
              : "Nenhum registrado"
          }
        />
        <Field
          label="Próxima manutenção"
          value={
            equipment.nextMaintenance
              ? formatDate(String(equipment.nextMaintenance))
              : "Sem vencimento previsto"
          }
        />
      </dl>

      {/**
       * Os contextos de PMOC vêm prontos, com elegibilidade **e** motivo já
       * decididos pelo servidor — inclusive o motivo de falta de permissão. A
       * tela mostra a frase que recebeu.
       */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Planos de manutenção preventiva
        </p>
        {equipment.pmocExecutableContexts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Este equipamento não está coberto por nenhum plano ativo.
          </p>
        ) : (
          <ul className="space-y-2">
            {equipment.pmocExecutableContexts.map((context) => (
              <li
                key={context.planId}
                className="rounded-lg border border-border px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`${ROUTES.pmoc}/${context.planId}`}
                    className="min-w-0 truncate text-sm font-medium hover:underline"
                  >
                    {context.planName}
                  </Link>
                  {context.dueOn ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      Vence em {formatDate(String(context.dueOn))}
                    </span>
                  ) : null}
                </div>
                {context.blockedReason ? (
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-400">
                    <AlertCircle
                      className="mt-0.5 size-3 shrink-0"
                      aria-hidden
                    />
                    {context.blockedReason}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * As ações são exatamente as que o servidor publicou.
 *
 * Nada é deduzido do estado — nem "está ativo, então pode abrir atendimento".
 * `allowedActions` já considerou permissões, situação do equipamento e os
 * contextos de PMOC e RVT; refazer essa conta aqui produziria um botão que a
 * API recusa, ou esconderia um que ela aceita.
 */
function ActionsPanel({ equipment }: { equipment: EquipmentFieldDetails }) {
  const [preparing, setPreparing] = useState(false);

  return (
    <section
      className="space-y-3 rounded-xl border border-border p-4"
      aria-label="Ações permitidas"
    >
      <h3 className="text-sm font-semibold">O que você pode fazer</h3>

      <ul className="space-y-2">
        {equipment.allowedActions.map((action) => {
          const presentation = fieldAction(action);
          /** Ação publicada que esta tela ainda não sabe apresentar não vira botão. */
          if (!presentation) return null;

          if (action === "START_SERVICE_ORDER") {
            return (
              <li key={action}>
                <Button
                  className="w-full justify-between"
                  variant="outline"
                  onClick={() => setPreparing(true)}
                >
                  {presentation.label}
                  <ArrowRight className="size-3.5" />
                </Button>
                <p className="mt-1 text-xs text-muted-foreground">
                  {presentation.description}
                </p>
              </li>
            );
          }

          const href =
            action === "EXECUTE_PMOC"
              ? equipment.pmocExecutableContexts.find((item) => item.eligible)
                  ?.planId
                ? `${ROUTES.pmoc}/${
                    equipment.pmocExecutableContexts.find(
                      (item) => item.eligible,
                    )!.planId
                  }`
                : null
              : action === "ADD_TO_RVT"
                ? equipment.availability.rvtExecutionIds[0]
                  ? `${ROUTES.rvt}/execucoes/${equipment.availability.rvtExecutionIds[0]}`
                  : null
                : `${ROUTES.assets}/${equipment.id}`;

          if (!href) return null;

          return (
            <li key={action}>
              <Button
                asChild
                className="w-full justify-between"
                variant="outline"
              >
                <Link href={href}>
                  {presentation.label}
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </li>
          );
        })}
      </ul>

      {preparing ? (
        <ServiceOrderPreparation
          equipmentId={equipment.id}
          onClose={() => setPreparing(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * Preparar não é criar.
 *
 * O contrato diz isso literalmente: a resposta carrega `operationCreated:
 * false`, um literal de tipo — não um booleano que um dia poderia vir `true`.
 * O que chega é o contexto para preencher o formulário; a criação continua
 * dependendo de alguém clicar em salvar.
 */
function ServiceOrderPreparation({
  equipmentId,
  onClose,
}: {
  equipmentId: string;
  onClose: () => void;
}) {
  const session = useSession();
  const preparation = useServiceOrderPreparation(equipmentId);

  if (!preparation.data) return null;

  return (
    <OperationFormDialog
      open
      editing={null}
      timeZone={session.user?.timezone ?? "America/Recife"}
      prefill={{
        businessUnitId: preparation.data.businessUnitId,
        customerId: preparation.data.customer?.id ?? "",
        assetId: preparation.data.equipment.id,
        title: `Atendimento — ${preparation.data.equipment.name}`,
        customerLabel: preparation.data.customer?.name,
        assetLabel: preparation.data.equipment.name,
      }}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    />
  );
}
