"use client";

/**
 * O detalhe de uma configuração de RVT.
 *
 * As abas são os conceitos do domínio, na ordem em que se pensa neles:
 *
 * ```text
 * Visão geral → a regra: cliente, local, periodicidade, RT
 * Visitas     → as ocorrências previstas, numeradas pelo servidor
 * Histórico   → o que aconteceu
 * ```
 *
 * Não há "Gerar documento" nesta tela: **configuração não é documento**. O RVT
 * emitido nasce da execução, e é de lá que se chega até ele.
 */
import { Pencil } from "lucide-react";
import { useState } from "react";

import { PanelError } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRvtConfiguration } from "@/hooks/rvt/use-rvt";
import { formatDate } from "@/lib/formatters";
import { useSession } from "@/providers/session-provider";
import { isOneTime, recurrenceLabel } from "@/registry";
import type { RvtConfiguration } from "@/types/rvt";
import { TabBoundary } from "@/workspace";
import { RvtConfigurationEditDialog } from "./rvt-configuration-edit.dialog";
import { RvtOccurrencesPanel } from "./rvt-occurrences";
import {
  ConfigurationStatusBadge,
  ScheduleModeBadge,
  MaintenanceTypeBadge,
} from "./rvt-presentation";
import { RvtTimelinePanel } from "./rvt-timeline";

export function RvtWorkspace({ configurationId }: { configurationId: string }) {
  const configuration = useRvtConfiguration(configurationId);

  if (configuration.isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (configuration.error) {
    return (
      <PanelError
        error={configuration.error}
        onRetry={() => void configuration.refetch()}
      />
    );
  }

  if (!configuration.data) return null;

  return (
    <div className="space-y-5">
      <ConfigurationHeader configuration={configuration.data} />

      <Tabs defaultValue="visao-geral">
        <TabsList>
          <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
          <TabsTrigger value="visitas">Visitas</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="visao-geral">
          <ConfigurationOverview configuration={configuration.data} />
        </TabsContent>

        <TabsContent value="visitas">
          <TabBoundary id="rvt-occurrences" label="as visitas">
            {/**
             * As ocorrências vêm dentro do detalhe, já ordenadas pelo servidor.
             * Uma segunda consulta a `/occurrences` traria as mesmas linhas e
             * abriria a chance de as duas listas discordarem na tela.
             */}
            <RvtOccurrencesPanel occurrences={configuration.data.occurrences} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="historico">
          <TabBoundary id="rvt-timeline" label="o histórico">
            <RvtTimelinePanel configurationId={configurationId} />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ConfigurationHeader({
  configuration,
}: {
  configuration: RvtConfiguration;
}) {
  const session = useSession();
  const canManage = session.hasPermission("rvt.manage");
  const [editing, setEditing] = useState(false);

  return (
    <header className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">
            {configuration.name}
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            {configuration.code}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConfigurationStatusBadge status={configuration.status} />
          <ScheduleModeBadge mode={configuration.scheduleMode} />
          {/** Visita avulsa não tem periodicidade a anunciar. */}
          {isOneTime(configuration) ? null : (
            <MaintenanceTypeBadge label={configuration.maintenanceType?.label} />
          )}
          {canManage ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditing(true)}
            >
              <Pencil className="size-3.5" />
              Editar
            </Button>
          ) : null}
        </div>
      </div>

      {isOneTime(configuration) ? (
        <p className="rounded-lg bg-surface-strong px-3 py-2 text-xs text-muted-foreground">
          Visita avulsa: uma única ocorrência, sem repetição. Visitas criadas
          pelo aplicativo de campo nascem assim.
        </p>
      ) : null}

      {canManage ? (
        <RvtConfigurationEditDialog
          configuration={configuration}
          open={editing}
          onOpenChange={setEditing}
        />
      ) : null}
    </header>
  );
}

function ConfigurationOverview({
  configuration,
}: {
  configuration: RvtConfiguration;
}) {
  return (
    <div className="space-y-4">
      <dl className="grid gap-4 rounded-xl border border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Cliente" value={configuration.customer.name} />
        <Field label="Unidade" value={configuration.businessUnit.name} />
        <Field label="Periodicidade" value={recurrenceLabel(configuration)} />
        <Field
          label="Vigência"
          value={
            configuration.coverage.end
              ? `${formatDate(configuration.coverage.start)} — ${formatDate(configuration.coverage.end)}`
              : formatDate(configuration.coverage.start)
          }
        />
        {/**
         * O fuso é da configuração, e é ele que decide o "hoje" de cada visita.
         * Mostrá-lo evita a leitura errada de quem abre a tela de outro estado.
         */}
        <Field label="Fuso horário" value={configuration.timezone} />
        <Field
          label="Técnico em Campo padrão"
          value={
            configuration.defaultResponsibleFieldTechnician?.name ??
            "Não definido"
          }
        />
      </dl>

      {/**
       * RT é **condicional**, e quem decide é o servidor.
       *
       * `requiresTechnicalResponsible` é a política publicada. Quando não é
       * exigido, a ausência de RT não é falha — e a tela não pinta um alerta
       * onde o domínio não vê problema.
       */}
      <section className="space-y-2 rounded-xl border border-border p-4">
        <h3 className="text-sm font-semibold">Responsável Técnico</h3>
        {configuration.requiresTechnicalResponsible ? (
          <p className="text-sm">
            Exigido nesta configuração.{" "}
            {configuration.technicalResponsible ? (
              <span className="font-medium">
                {configuration.technicalResponsible.name}
              </span>
            ) : (
              <span className="text-amber-400">
                Nenhum Responsável Técnico definido.
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Não exigido nesta configuração.
            {configuration.technicalResponsible
              ? ` Indicado: ${configuration.technicalResponsible.name}.`
              : ""}
          </p>
        )}
      </section>

      <section className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Equipamentos previstos</h3>
          <Badge variant="secondary">{configuration.equipment.length}</Badge>
        </div>
        {configuration.equipment.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum equipamento vinculado. A visita pode registrar equipamentos
            em campo.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {configuration.equipment.map((item) => (
              <li
                key={item.id}
                className="min-w-0 rounded-lg border border-border px-3 py-2"
              >
                <p className="truncate text-sm font-medium">{item.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {item.identifier ?? item.serialNumber ?? item.category}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  );
}
