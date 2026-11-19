"use client";

import { useState } from "react";
import Link from "next/link";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import { ROUTES } from "@/lib/routes";
import type { EquipmentServiceHistoryPageReadModel } from "@/types/contracts/modules/organizations/business-units/equipaments/equipment-qr.read-models";

const serviceLabels: Record<string, string> = {
  SERVICE_ORDER: "Ordem de serviço",
  PMOC: "Execução de PMOC",
  RVT: "Visita técnica",
  INSTALLATION: "Instalação",
  MAINTENANCE: "Manutenção",
  INSPECTION: "Inspeção",
};

export function AssetServiceHistory({ assetId }: { assetId: string }) {
  const [page, setPage] = useState(1);
  const { formatDateTime } = useDateFormatters();
  const query = useApiQuery(
    queryKeys.query("assets", "service-history", { assetId, page }),
    ({ signal }) =>
      apiClient.get<EquipmentServiceHistoryPageReadModel>(
        `/assets/${assetId}/service-history?page=${page}&limit=10`,
        { signal },
      ),
  );

  return (
    <PanelFrame
      panelId="asset-service-history"
      title="Histórico de atendimentos"
    >
      <PanelState
        query={toPanelQuery(query)}
        isEmpty={(result) => result.data.length === 0}
        emptyMessage="Nenhum atendimento concluído para este equipamento."
      >
        {(result) => (
          <div className="space-y-4">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {result.data.map((item) => (
                <li
                  key={`${item.id}:${item.completedAt}`}
                  className="space-y-2 p-4"
                >
                  <Link
                    href={`${ROUTES.operations}/${item.id}`}
                    className="text-sm font-semibold hover:underline"
                  >
                    {item.title}
                  </Link>
                  <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>{serviceLabels[item.type] ?? "Atendimento"}</span>
                    <span>{item.serviceOrderCode ?? item.code}</span>
                    {item.completedAt ? (
                      <span>{formatDateTime(String(item.completedAt))}</span>
                    ) : null}
                    <span>{item.technicianName ?? "Técnico sem registro"}</span>
                  </p>
                  {item.description && (
                    <p className="whitespace-pre-wrap text-sm">
                      {item.description}
                    </p>
                  )}
                  {item.observations.length > 0 ? (
                    <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
                      <p className="font-medium">Observações do atendimento</p>
                      {item.observations.map((note) => (
                        <p key={note} className="whitespace-pre-wrap">
                          {note}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sem observações registradas.
                    </p>
                  )}
                </li>
              ))}
            </ul>
            {result.meta.totalPages > 1 ? (
              <nav
                aria-label="Páginas do histórico"
                className="flex items-center justify-between gap-2"
              >
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Página {page} de {result.meta.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= result.meta.totalPages}
                  onClick={() => setPage(page + 1)}
                >
                  Próxima
                </Button>
              </nav>
            ) : null}
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}
