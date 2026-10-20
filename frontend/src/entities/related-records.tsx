"use client";

/**
 * Painel de registros relacionados — dirigido pelo Entity Registry.
 *
 * Nasceu no Asset Workspace e subiu para cá quando o Customer Workspace
 * precisou exatamente do mesmo painel. É a forma concreta do que o registry
 * promete: **um componente** desenha operações, agendamentos, execuções e
 * ativos, resolvendo ícone, cor, rótulo, rota e badge de status pelo
 * `EntityId`. Não há `switch` de entidade em lugar algum da árvore.
 *
 * O que ele **não** faz: buscar dados. Recebe a consulta pronta e uma função
 * que converte a resposta em linhas — assim a fonte fica no hook do módulo
 * dono, e este componente serve qualquer uma.
 */
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { EntityBadge, EntityLink } from "./entity-components";
import { resolveEntity, type EntityId } from "./entity-registry";

export interface RelatedRow {
  readonly key: string;
  /** Id do registro na entidade — é o que o `EntityLink` navega. */
  readonly entityId: string;
  readonly title: string;
  readonly subtitle: string;
  readonly status?: string;
}

export interface RelatedQuery<TData> {
  data: TData | undefined;
  isPending: boolean;
  error: unknown;
  refetch: () => unknown;
}

export function RelatedRecordsPanel<TData>({
  entity,
  panelId,
  title,
  description,
  query,
  toRows,
  emptyMessage,
  seeAllHref,
}: {
  entity: EntityId;
  panelId: string;
  title: string;
  description: string;
  query: RelatedQuery<TData>;
  toRows: (data: TData) => readonly RelatedRow[];
  emptyMessage: string;
  /**
   * O destino do "Ver tudo". **Opcional**: nem todo recorte tem uma listagem
   * global correspondente, e mandar para uma lista sem o filtro seria pior do
   * que não oferecer o link — pareceria um filtro que silenciosamente não
   * valeu.
   */
  seeAllHref?: string;
}) {
  const definition = resolveEntity(entity);

  return (
    <PanelFrame
      panelId={panelId}
      title={title}
      description={description}
      actions={
        seeAllHref ? (
          <Button size="sm" variant="ghost" asChild>
            <Link href={seeAllHref}>
              Ver tudo
              <ArrowUpRight className="size-3.5" />
            </Link>
          </Button>
        ) : null
      }
    >
      <PanelState
        query={toPanelQuery(query)}
        loadingRows={3}
        isEmpty={(data) => toRows(data).length === 0}
        emptyMessage={emptyMessage}
      >
        {(data) => (
          <ul className="space-y-2">
            {toRows(data).map((row) => (
              <li
                key={row.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
              >
                <definition.icon
                  className={`size-4 shrink-0 ${definition.color}`}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <EntityLink
                    entity={entity}
                    id={row.entityId}
                    className="text-sm font-medium"
                  >
                    <span className="truncate">{row.title}</span>
                  </EntityLink>
                  <p className="text-xs text-muted-foreground">
                    {row.subtitle}
                  </p>
                </div>
                {row.status ? (
                  <EntityBadge
                    entity={entity}
                    group="status"
                    value={row.status}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </PanelState>
    </PanelFrame>
  );
}
