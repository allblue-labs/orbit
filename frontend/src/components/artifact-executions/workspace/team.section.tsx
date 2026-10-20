"use client";

/**
 * Equipe da execução.
 *
 * `team` traz `userId`, `role` e `assignedAt`. **Não há endpoint que liste ou
 * resolva membros do tenant** — lacuna já registrada no manifesto de
 * contratos —, então o painel apresenta papel e data e identifica a pessoa
 * pelo identificador abreviado.
 *
 * Pela mesma razão o painel não oferece incluir alguém: `PATCH /:id` aceita
 * `team`, mas montar a lista exigiria escolher um `userId`, e não existe fonte
 * de onde escolhê-lo. Um campo de UUID cru não é uma funcionalidade.
 */
import { UsersRound } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/formatters";
import type { ArtifactExecution } from "@/types/artifact-executions";
import { UserReference } from "./overview.section";

export function TeamSection({ execution }: { execution: ArtifactExecution }) {
  const responsible = execution.responsibleUserId;

  return (
    <PanelFrame
      panelId="artifact-execution-team"
      title="Equipe"
      description={`${execution.team.length} pessoa(s) atribuída(s)`}
    >
      {execution.team.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nenhuma pessoa atribuída a esta execução.
        </p>
      ) : (
        <ul className="space-y-2">
          {execution.team.map((member) => (
            <li
              key={`${member.userId}-${member.role}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
            >
              <UsersRound
                className="size-4 text-muted-foreground"
                aria-hidden
              />
              <UserReference userId={member.userId} />
              <Badge variant="secondary" className="text-[10px]">
                {member.role}
              </Badge>
              {member.userId === responsible ? (
                <Badge className="text-[10px]">responsável</Badge>
              ) : null}
              <span className="ml-auto text-xs text-muted-foreground">
                desde {formatDate(member.assignedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        Os nomes dos membros da organização ainda não estão disponíveis nesta tela.
      </p>
    </PanelFrame>
  );
}
