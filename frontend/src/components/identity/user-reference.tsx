"use client";

/**
 * Nome de uma pessoa, a partir do `userId` que os contratos publicam.
 *
 * ## O problema que resolve
 *
 * Vários Read Models publicam só o identificador —
 * `ArtifactExecutionListItemReadModel.responsibleUserId`,
 * `ArtifactExecutionReadModel.createdById`, `OperationListItemReadModel.createdById`.
 * A operação publica `users[].user.displayName` embutido, mas a execução não.
 *
 * A versão anterior deste componente mostrava os oito primeiros caracteres do
 * uuid. Era honesto — não inventava nome — e inútil: ninguém reconhece
 * `01924f3a`.
 *
 * ## A resolução
 *
 * `GET /organizations/current/members` publica as pessoas da organização com
 * `displayName`. É contrato público, criado na PR-12 exatamente porque
 * atribuir trabalho exige conhecer quem existe.
 *
 * A consulta é **uma só para a aplicação inteira**: a key é do módulo
 * `organizations`, a política é `CACHE.catalog` (dez minutos, sem revalidação
 * automática) e o TanStack Query deduplica. Cem linhas de tabela pedindo cem
 * nomes fazem uma requisição.
 *
 * ## Quando não resolve
 *
 * Volta ao identificador truncado. Acontece em três casos legítimos: o plano
 * não concede a leitura de membros, a pessoa saiu da organização, ou o id é de
 * outro tenant. Em nenhum deles se inventa um nome.
 */
import { useOrganizationMembers } from "@/hooks/organization/use-organization";
import { cn } from "@/lib/utils";

export function UserReference({
  userId,
  className,
}: {
  userId: string | null | undefined;
  className?: string;
}) {
  const members = useOrganizationMembers();

  if (!userId) {
    return <span className={cn("text-muted-foreground", className)}>—</span>;
  }

  /* `data` é a página; `data.data` são as pessoas. O tipo do serviço dizia que
     a resposta era um array e o `.find` compilava — estourava em execução, na
     primeira linha de tabela que mostrasse um nome. */
  const member = members.data?.data.find((item) => item.userId === userId);

  if (!member) {
    return (
      <span
        className={cn("font-mono text-xs text-muted-foreground", className)}
        title={userId}
      >
        {userId.slice(0, 8)}
      </span>
    );
  }

  return (
    <span className={cn("text-sm", className)} title={member.email}>
      {member.displayName}
    </span>
  );
}
