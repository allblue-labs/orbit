"use client";

/**
 * Registros relacionados ao ativo: operações, agenda futura e artefatos.
 *
 * Os três painéis são o **mesmo componente** com fontes diferentes. É o Entity
 * Registry que torna isso possível: cada linha resolve rótulo, ícone, cor,
 * rota e badge de status pelo `EntityId`, sem que este arquivo saiba o que é
 * uma operação, um agendamento ou uma execução.
 *
 * **Nada é filtrado no cliente.** `assetId` é filtro real nos três contratos
 * (`OperationQueryDto`, `EventQueryDto`, `ArtifactExecutionQueryDto`), e a
 * navegação para os respectivos Workspaces sai do registry.
 */
import { RelatedRecordsPanel } from "@/entities";
import {
  useAssetExecutions,
  useAssetOperations,
  useAssetSchedule,
} from "@/hooks/assets/use-assets";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";

export function AssetOperationsSection({ assetId }: { assetId: string }) {
  const query = useAssetOperations(assetId);

  return (
    <RelatedRecordsPanel
      entity="operation"
      panelId="asset-operations"
      title="Operações"
      description="Ordens de serviço executadas neste ativo"
      query={query}
      emptyMessage="Nenhuma operação registrada para este ativo."
      seeAllHref={ROUTES.operations}
      toRows={(page) =>
        page.data.map((operation) => ({
          key: operation.id,
          entityId: operation.id,
          title: operation.title,
          subtitle: `${operation.code}${
            operation.scheduledStart
              ? ` · ${formatDateTime(operation.scheduledStart)}`
              : ""
          }`,
          status: operation.status,
        }))
      }
    />
  );
}

export function AssetScheduleSection({ assetId }: { assetId: string }) {
  const query = useAssetSchedule(assetId);

  return (
    <RelatedRecordsPanel
      entity="scheduling-event"
      panelId="asset-schedule"
      title="Agenda futura"
      description="Próximos 90 dias, incluindo compromissos recorrentes"
      query={query}
      emptyMessage="Nada agendado para este ativo nos próximos 90 dias."
      seeAllHref={ROUTES.scheduling}
      toRows={(occurrences) =>
        occurrences.slice(0, 5).map((occurrence) => ({
          key: occurrence.occurrenceId,
          entityId: occurrence.eventId,
          title: occurrence.title,
          subtitle: `${formatDateTime(occurrence.startsAt)} · ${occurrence.type}`,
          status: occurrence.status,
        }))
      }
    />
  );
}

export function AssetExecutionsSection({ assetId }: { assetId: string }) {
  const query = useAssetExecutions(assetId);

  return (
    <RelatedRecordsPanel
      entity="artifact-execution"
      panelId="asset-executions"
      title="Artefatos executados"
      description="PMOCs, relatórios e checklists preenchidos neste ativo"
      query={query}
      emptyMessage="Nenhum artefato executado neste ativo."
      /** O vínculo viaja na URL: "ver todos" abre a fila deste ativo, não a da organização. */
      toRows={(page) =>
        page.data.map((execution) => ({
          key: execution.id,
          entityId: execution.id,
          title: execution.title,
          subtitle: `${execution.code} · ${execution.progress}% concluído`,
          status: execution.status,
        }))
      }
    />
  );
}
