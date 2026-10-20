"use client";

/**
 * A equipe técnica: quem opera, e quem ainda não pode.
 *
 * ## Quem é "técnico" — e o defeito que isto corrige
 *
 * Quem pode ser atribuído a um atendimento é quem tem `ProfessionalProfile`
 * ativo com técnico de campo: `validateTechnicianAssignments`, no servidor,
 * recusa qualquer outro. O **papel de acesso** não entra nessa conta.
 *
 * Isso cria uma armadilha que esta aba passa a expor em vez de esconder: dá para
 * cadastrar um membro com o papel "Técnico Operacional" e ele continuar invisível
 * para a operação — não aparece no seletor de atribuição, não recebe comissão, e
 * a lista de técnicos vem vazia. Era exatamente o que acontecia, e a tela não
 * dizia nada.
 *
 * Agora são duas listas: quem está habilitado (com comissão e carga) e quem é
 * membro mas ainda não tem o perfil, com o caminho para habilitar. A segunda
 * lista existe para desaparecer.
 *
 * ## A tabela vem do Financeiro
 *
 * É o mesmo componente da aba Comissão, e os números vêm do mesmo endpoint.
 * Duas implementações divergiriam no primeiro número novo, e a desta aba — que
 * quem administra abre mais — seria a que ficaria para trás.
 *
 * Quem não tem acesso financeiro não vê dinheiro: nesse caso a aba mostra a
 * carga de trabalho, sem valores.
 */
import { useMemo } from "react";
import { ArrowRight, HardHat, UserCog } from "lucide-react";
import Link from "next/link";

import { CommissionTechniciansSection } from "@/components/financial/commission-technicians.section";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useFieldTechnicians,
  useTeamMembers,
} from "@/hooks/workforce/use-workforce";
import { teamMemberRoute } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import { WorkloadCards } from "../workload-cards";

export function TechniciansTab() {
  const session = useSession();

  return (
    <div className="space-y-6">
      {/* A tabela de comissão depende de leitura financeira, porque comissão é
          dinheiro. Sem ela, resta a carga de trabalho. */}
      {session.hasPermission("financial.read") ? (
        <CommissionTechniciansSection
          canManage={
            session.hasPermission("financial.manage") &&
            session.hasCapability("financial.manage")
          }
        />
      ) : (
        <FieldTechnicianWorkload />
      )}

      <PendingProfiles />
    </div>
  );
}

/**
 * Os membros que ainda não são técnicos de campo.
 *
 * É a lista que explica uma tabela vazia. Some quando todo mundo estiver
 * habilitado — e é isso que se quer.
 */
function PendingProfiles() {
  const members = useTeamMembers({ page: 1, limit: 100 });
  const technicians = useFieldTechnicians();

  const pendentes = useMemo(() => {
    const habilitados = new Set(
      (technicians.data ?? []).map((profile) => profile.id),
    );
    return (members.data?.data ?? []).filter(
      (member) => !habilitados.has(member.userId),
    );
  }, [members.data, technicians.data]);

  if (members.isPending || technicians.isPending) {
    return (
      <PanelFrame
        panelId="technicians-pending"
        title="Membros sem perfil de técnico"
        description="Carregando a equipe"
      >
        <PanelLoading rows={2} />
      </PanelFrame>
    );
  }

  if (members.error) {
    return (
      <PanelFrame
        panelId="technicians-pending"
        title="Membros sem perfil de técnico"
        description="Quem ainda não pode ser atribuído"
      >
        <PanelError
          error={members.error}
          onRetry={() => void members.refetch()}
        />
      </PanelFrame>
    );
  }

  if (pendentes.length === 0) return null;

  return (
    <PanelFrame
      panelId="technicians-pending"
      title="Membros sem perfil de técnico de campo"
      description="Não podem ser atribuídos a um atendimento nem receber comissão"
      actions={<Badge variant="outline">{pendentes.length}</Badge>}
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          O papel de acesso diz o que a pessoa pode fazer no sistema; o perfil
          profissional diz o que ela faz em campo. São independentes — e é o
          segundo que a atribuição de atendimento exige.
        </p>

        <ul className="space-y-2">
          {pendentes.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {member.displayName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.role.name}
                </span>
              </span>
              <Button variant="outline" size="sm" asChild>
                <Link href={teamMemberRoute(member.userId)}>
                  <UserCog className="size-4" />
                  Habilitar
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </PanelFrame>
  );
}

/**
 * A carga de cada técnico, para quem não tem acesso financeiro.
 *
 * A fonte é o mesmo `GET /workforce/field-technicians` que o seletor de
 * atribuição usa: as duas telas listam as mesmas pessoas.
 */
function FieldTechnicianWorkload() {
  const technicians = useFieldTechnicians();

  return (
    <PanelFrame
      panelId="technicians-workload"
      title="Técnicos de campo"
      description="Carga de trabalho de quem pode ser atribuído"
    >
      {technicians.isPending ? (
        <PanelLoading rows={3} />
      ) : technicians.error ? (
        <PanelError
          error={technicians.error}
          onRetry={() => void technicians.refetch()}
        />
      ) : (technicians.data?.length ?? 0) === 0 ? (
        <p className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
          <HardHat className="size-5" aria-hidden />
          Nenhum técnico de campo habilitado. O perfil profissional de cada
          pessoa define quem pode ser atribuído a um atendimento.
        </p>
      ) : (
        <ul className="space-y-4">
          {technicians.data?.map((technician) => (
            <li
              key={technician.id}
              className="space-y-3 rounded-xl border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{technician.name}</span>
                  {technician.professionalCredential ? (
                    <Badge variant="outline">
                      {technician.professionalCredential.registrationNumber}
                    </Badge>
                  ) : null}
                  {technician.active ? null : (
                    <Badge variant="outline">perfil inativo</Badge>
                  )}
                </span>
                <Button variant="ghost" size="sm" asChild>
                  <Link href={teamMemberRoute(technician.id)}>
                    Detalhes
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
              </div>

              <WorkloadCards userId={technician.id} />
            </li>
          ))}
        </ul>
      )}
    </PanelFrame>
  );
}
