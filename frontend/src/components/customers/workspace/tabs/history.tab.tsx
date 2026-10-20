"use client";

/**
 * Histórico do cliente — a ausência, declarada.
 *
 * ## O que existe no banco
 *
 * `AuditLog` tem exatamente a forma necessária: `entityType`, `entityId`,
 * `action`, `before`, `after`, `userId`, `createdAt`, e até um índice
 * `@@index([entityType, entityId, createdAt])`. Os repositórios de artefato,
 * manifest e renderização já escrevem nele.
 *
 * ## O que não existe
 *
 * **Nenhum endpoint o publica para um tenant.** Não há
 * `GET /customers/:id/history`, `GET /assets/:id/history`, nem rota de
 * auditoria geral — verificado em todos os controllers. O dado está lá e não
 * tem porta.
 *
 * ## Por que a tela não reconstrói
 *
 * Daria para montar uma linha do tempo juntando `createdAt`/`updatedAt` das
 * operações, execuções e agendamentos que já são carregados. Seria uma
 * **invenção**: mostraria "cliente atualizado" sem saber o que mudou, quem
 * mudou ou por quê, e omitiria tudo que não passa por essas quatro listas.
 * Uma linha do tempo incompleta que parece completa é pior que nenhuma.
 *
 * O que existe de datado está nas abas, cada registro com a sua data — e é
 * isso que a tela oferece.
 */
import { History } from "lucide-react";

import { PanelFrame } from "@/components/panels";

export function HistoryTab() {
  return (
    <PanelFrame
      panelId="customer-history"
      title="Histórico"
      description="Eventos do relacionamento ao longo do tempo"
    >
      <div className="flex min-h-32 flex-col items-center justify-center gap-3 text-center">
        <History className="size-6 text-muted-foreground" aria-hidden />
        <div className="max-w-lg space-y-2">
          <p className="text-sm font-medium">
            O histórico do cliente ainda não está disponível
          </p>
          <p className="text-sm text-muted-foreground">
            As alterações ficam registradas, mas ainda não podem ser consultadas aqui. Enquanto isso, o que existe de datado está nas abas
            de Equipamentos, Operações, Execuções e Documentos — cada registro
            com a sua própria data.
          </p>
          <p className="text-xs text-muted-foreground">
            Nada é reconstruído aqui: uma linha do tempo montada a partir das
            listas pareceria completa sem ser.
          </p>
        </div>
      </div>
    </PanelFrame>
  );
}
