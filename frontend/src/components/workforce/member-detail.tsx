"use client";

/**
 * Detalhe de um membro — em página, e não em painel lateral.
 *
 * ## Por que deixou de ser drawer
 *
 * O conteúdo é o de uma tela: carga de trabalho, perfil profissional,
 * especialidades, certificações, permissões efetivas, unidades, listas
 * relacionadas e agora a comissão, com histórico e pagamentos. Num painel
 * lateral isso é uma coluna estreita com rolagem longa, que não pode ser
 * guardada nos favoritos, aberta em outra aba nem recarregada — e era o que
 * acontecia: o painel recebia o objeto da listagem, então um endereço direto não
 * tinha de onde buscar a pessoa.
 *
 * A página carrega o membro por `GET /organizations/current/members/:userId`,
 * rota que passou a existir para isto.
 *
 * ## Nada é calculado aqui
 *
 * Os números são `meta.total` do servidor. Não há produtividade: o Analytics
 * publica indicadores **da organização**, não de uma pessoa. Derivar "operações
 * por dia" das listas carregadas seria inventar um indicador — e um indicador de
 * desempenho inventado é pior que nenhum, porque alguém decide com ele.
 */
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  Workflow,
} from "lucide-react";

import { ContentContainer } from "@/components/layout/page-primitives";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EntityBadge, entityHref } from "@/entities";
import {
  useAccessCatalog,
  useMemberExecutions,
  useMemberOperations,
  useMemberSchedule,
  useTeamMember,
} from "@/hooks/workforce/use-workforce";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import { ROUTES } from "@/lib/routes";
import { sectionHref } from "@/lib/section-navigation";
import { useSession } from "@/providers/session-provider";
import type { TeamMember } from "@/types/workforce";
import { MemberActions } from "./member-actions";
import { MemberCertificationsSection } from "./member-certifications.section";
import { MemberProfessionalSection } from "./member-professional.section";
import { MemberSpecialtiesSection } from "./member-specialties.section";
import { MemberCommissionSection } from "./member-commission.section";
import { WorkloadCards } from "./workload-cards";

export function MemberDetail({ userId }: { userId: string }) {
  const query = useTeamMember(userId);

  return (
    <ContentContainer size="wide" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href={sectionHref(ROUTES.team, "usuarios")}>
            <ArrowLeft className="size-4" />
            Voltar para a equipe
          </Link>
        </Button>
      </div>

      {query.isPending ? (
        <PanelLoading rows={8} />
      ) : query.error || !query.data ? (
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Body member={query.data} />
      )}
    </ContentContainer>
  );
}

function Body({ member }: { member: TeamMember }) {
  const { formatDateTime } = useDateFormatters();
  const session = useSession();
  const catalog = useAccessCatalog();
  const permissionLabels = new Map(
    (catalog.data?.permissionGroups ?? []).flatMap((group) =>
      group.permissions.map(
        (permission) => [permission.code, permission.label] as const,
      ),
    ),
  );

  /* Administrar a equipe e ver dinheiro são permissões diferentes. */
  const podeAdministrarEquipe =
    session.hasPermission("organization.members.update") &&
    session.hasCapability("workforce.manage");

  return (
    <>
      <header className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-2 text-lg font-semibold">
          {member.displayName}
          {member.isOwner ? <Badge variant="secondary">Dono</Badge> : null}
          <EntityBadge
            entity="team-member"
            group="status"
            value={member.status}
          />
        </h1>
        <p className="text-sm text-muted-foreground">
          {member.email} · na equipe desde {formatDateTime(member.joinedAt)}
        </p>
      </header>

      <div className="space-y-6">
        <MemberActions member={member} />

        <WorkloadCards userId={member.userId} />

        <MemberCommissionSection userId={member.userId} />

        <MemberProfessionalSection
          userId={member.userId}
          canManage={podeAdministrarEquipe}
        />

        <MemberSpecialtiesSection userId={member.userId} />

        <MemberCertificationsSection userId={member.userId} />

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Papel e permissões efetivas</h3>
          <div className="rounded-xl border border-border p-4">
            <p className="flex items-center gap-2">
              <Badge variant="outline">{member.role.name}</Badge>
              <span className="font-mono text-xs text-muted-foreground">
                {member.role.key}
              </span>
            </p>

            {catalog.isPending ? (
              <Skeleton className="mt-3 h-16 w-full" />
            ) : (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  {member.access.useRoleDefaults
                    ? "Usa as permissões recomendadas pelo papel."
                    : "Possui um conjunto de permissões personalizado."}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {member.access.allowedSurfaces.map((surface) => (
                    <Badge key={surface} variant="secondary">
                      {catalog.data?.surfaces.find(
                        (item) => item.code === surface,
                      )?.label ?? surface}
                    </Badge>
                  ))}
                </div>
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {member.access.permissions.map((permission) => (
                    <li key={permission}>
                      <span className="rounded-md bg-surface-strong px-2 py-0.5 text-[11px] text-muted-foreground">
                        {permissionLabels.get(permission) ?? "Acesso legado"}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">Organizações</h3>
          {member.businessUnits.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {member.businessUnits.map((unit) => (
                <li key={unit.id}>
                  <Badge variant="outline">
                    {unit.tradeName ?? unit.legalName}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem vínculo de unidade — o acesso é em nível de organização.
            </p>
          )}
        </section>

        <RelatedSection userId={member.userId} />
      </div>
    </>
  );
}

/**
 * O que a pessoa tem para fazer.
 *
 * Três listas curtas, cada uma do módulo dono, com "ver todas" levando ao
 * Workspace daquele módulo já filtrado. A navegação usa o Entity Registry —
 * nenhuma rota é montada à mão.
 */
function RelatedSection({ userId }: { userId: string }) {
  const { formatDateTime } = useDateFormatters();
  const operations = useMemberOperations(userId);
  const executions = useMemberExecutions(userId);
  const schedule = useMemberSchedule(userId);

  return (
    <div className="space-y-4">
      <RelatedList
        icon={<Workflow className="size-4" aria-hidden />}
        title="Operações atribuídas"
        isPending={operations.isPending}
        empty="Nenhuma operação atribuída."
        seeAllHref={`${ROUTES.operations}?assignedUserId=${userId}`}
        rows={(operations.data?.data ?? []).map((operation) => ({
          key: operation.id,
          href: entityHref("operation", operation.id),
          title: operation.title,
          subtitle: operation.code,
          badge: (
            <EntityBadge
              entity="operation"
              group="status"
              value={operation.status}
            />
          ),
        }))}
      />

      <RelatedList
        icon={<ClipboardCheck className="size-4" aria-hidden />}
        title="Execuções em andamento"
        isPending={executions.isPending}
        empty="Nenhuma execução sob responsabilidade."

        rows={(executions.data?.data ?? []).map((execution) => ({
          key: execution.id,
          href: entityHref("artifact-execution", execution.id),
          title: execution.title,
          subtitle: `${execution.code} · ${execution.progress}%`,
          badge: null,
        }))}
      />

      <RelatedList
        icon={<CalendarClock className="size-4" aria-hidden />}
        title="Próximos compromissos"
        isPending={schedule.isPending}
        empty="Nada agendado nos próximos 30 dias."
        seeAllHref={ROUTES.scheduling}
        rows={(schedule.data ?? []).slice(0, 5).map((event, index) => ({
          key: `${event.eventId}-${index}`,
          href: null,
          title: event.title,
          subtitle: formatDateTime(event.startsAt),
          badge: null,
        }))}
      />
    </div>
  );
}

interface RelatedRow {
  key: string;
  href: string | null;
  title: string;
  subtitle: string;
  badge: React.ReactNode;
}

function RelatedList({
  icon,
  title,
  isPending,
  empty,
  rows,
  seeAllHref,
}: {
  icon: React.ReactNode;
  title: string;
  isPending: boolean;
  empty: string;
  rows: readonly RelatedRow[];
  /**
   * O destino do "Ver todas". **Opcional**: nem todo recorte tem uma listagem
   * global correspondente, e mandar para uma lista sem o filtro seria pior do
   * que não oferecer o link — pareceria um filtro que silenciosamente não
   * valeu.
   */
  seeAllHref?: string;
}) {
  return (
    <section className="rounded-xl border border-border">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {icon}
          {title}
        </h3>
        {seeAllHref ? (
          <Button variant="ghost" size="sm" asChild>
            <Link href={seeAllHref}>
              Ver todas
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        ) : null}
      </header>

      {isPending ? (
        <div className="space-y-2 p-4">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                {row.href ? (
                  <Link href={row.href} className="font-medium hover:underline">
                    {row.title}
                  </Link>
                ) : (
                  <span className="font-medium">{row.title}</span>
                )}
                <span className="block font-mono text-xs text-muted-foreground">
                  {row.subtitle}
                </span>
              </span>
              {row.badge}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
