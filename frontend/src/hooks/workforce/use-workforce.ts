"use client";

/**
 * Query Layer do Workforce Management.
 *
 * ## Cadência
 *
 * Equipe é cadastro: muda quando alguém convida, aceita ou sai. Nada aqui se
 * recarrega sozinho. Papéis mudam ainda menos — `CACHE.catalog`.
 *
 * ## Uma consulta de membros para a aplicação inteira
 *
 * A key é a de `organizations`, a mesma que o `UserReference` e o Organization
 * Workspace já usam. Três telas pedindo a equipe fazem **uma** requisição.
 *
 * ## Visão técnica: nada é recortado no cliente
 *
 * `assignedUserId`, `responsibleUserId` e `userId` são filtros reais de
 * `OperationQueryDto`, `ArtifactExecutionQueryDto` e `EventQueryDto`. O que a
 * tela mostra por pessoa é o que o servidor contou.
 */
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/query-keys";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE, MINUTE, every } from "@/hooks/api/cache-policy";
import { artifactExecutionsService } from "@/services/artifact-executions.service";
import { operationsService } from "@/services/operations.service";
import { schedulingService } from "@/services/scheduling.service";
import { commissionsService } from "@/services/commissions.service";
import { workforceService } from "@/services/workforce.service";
import type { ArtifactExecutionQuery } from "@/types/artifact-executions";
import type { OperationQuery } from "@/types/operations";
import type {
  AddTeamMemberInput,
  AssignSpecialtyInput,
  CertificationQuery,
  CreateCertificationInput,
  CreateInvitationInput,
  CreateRoleInput,
  CreateSpecialtyInput,
  CreateTeamInput,
  InvitationQuery,
  MemberQuery,
  ProfessionalSelectorQuery,
  UpdateCertificationInput,
  UpdateMemberInput,
  UpdateProfessionalProfileInput,
  UpdateRoleInput,
  UpdateSpecialtyInput,
  UpdateTeamInput,
  CreateTeamMemberInput,
} from "@/types/workforce";

export const WORKFORCE_REFRESH = {
  members: CACHE.stable,
  roles: CACHE.catalog,
  /** Elenco profissional muda pouco, mas não é catálogo: perfil é desativado. */
  professionals: CACHE.stable,
  specialties: CACHE.catalog,
  certifications: CACHE.stable,
  teams: CACHE.stable,
  /**
   * Posição envelhece por natureza.
   *
   * `live` revalida a cada minuto enquanto a tela está aberta — é o que faz
   * "onde a equipe está" continuar respondendo à pergunta ao longo do tempo.
   */
  locations: CACHE.live,
  /** Convite expira sozinho; a lista revalida para o prazo não ficar velho. */
  invitations: every(CACHE.stable, 5 * MINUTE),
  related: CACHE.fresh,
} as const;

/** Horizonte da agenda da pessoa, em dias. */
const SCHEDULE_HORIZON_DAYS = 30;

/* ------------------------------------------------------------------ */
/* Leituras                                                            */
/* ------------------------------------------------------------------ */

/**
 * Membros da organização, paginados.
 *
 * `GET /organizations/current/members` passou a paginar; a key inclui a
 * consulta, então páginas diferentes não se sobrescrevem no cache.
 *
 * `useOrganizationMembers` continua existindo para quem só precisa resolver um
 * nome — o `UserReference` é o caso — e pede uma página única e ampla, porque
 * ali não há como saber em que página está a pessoa procurada.
 */
export function useTeamMembers(query?: MemberQuery) {
  return useApiQuery(
    workforceService.keys.members(query),
    ({ signal }) => workforceService.members(query, { signal }),
    { ...WORKFORCE_REFRESH.members, placeholderData: (previous) => previous },
  );
}

/* ------------------------------------------------------------------ */
/* Domínio profissional (PR-27)                                        */
/* ------------------------------------------------------------------ */

/**
 * Candidatos a Técnico em Campo desta unidade.
 *
 * O `signal` chega ao `fetch`: trocar de unidade ou fechar o seletor cancela
 * a consulta anterior em vez de deixá-la responder no escopo novo.
 *
 * `enabled` desliga a consulta enquanto o seletor está fechado — um diálogo
 * que ninguém abriu não precisa buscar o elenco da filial.
 */
export function useFieldTechnicians(
  query?: ProfessionalSelectorQuery,
  enabled = true,
) {
  return useApiQuery(
    workforceService.keys.professionals("FIELD_TECHNICIAN", query),
    ({ signal }) => workforceService.fieldTechnicians(query, { signal }),
    { ...WORKFORCE_REFRESH.professionals, enabled },
  );
}

/**
 * Quem pode acompanhar um atendimento como auxiliar.
 *
 * Lista diferente da de técnicos, e não a mesma filtrada: o auxiliar não tem
 * perfil profissional, porque não assina nada. Quem responde é o servidor —
 * refiltrar aqui seria reimplementar a elegibilidade com metade da informação.
 */
export function useFieldAssistants(
  query?: ProfessionalSelectorQuery,
  enabled = true,
) {
  return useApiQuery(
    workforceService.keys.fieldAssistants(query),
    ({ signal }) => workforceService.fieldAssistants(query, { signal }),
    { ...WORKFORCE_REFRESH.professionals, enabled },
  );
}

/** Candidatos a Responsável Técnico. Seletor próprio — ver `registry/professional`. */
export function useTechnicalResponsibles(
  query?: ProfessionalSelectorQuery,
  enabled = true,
) {
  return useApiQuery(
    workforceService.keys.professionals("TECHNICAL_RESPONSIBLE", query),
    ({ signal }) => workforceService.technicalResponsibles(query, { signal }),
    { ...WORKFORCE_REFRESH.professionals, enabled },
  );
}

/** Um membro, pela pessoa. É o que a página de detalhe carrega. */
export function useTeamMember(userId: string | null) {
  return useApiQuery(
    workforceService.keys.member(userId ?? ""),
    ({ signal }) => workforceService.member(userId!, { signal }),
    { ...WORKFORCE_REFRESH.members, enabled: Boolean(userId) },
  );
}

export function useProfessionalProfile(userId: string | null) {
  return useApiQuery(
    workforceService.keys.professionalProfile(userId ?? ""),
    ({ signal }) => workforceService.professionalProfile(userId!, { signal }),
    { ...WORKFORCE_REFRESH.professionals, enabled: Boolean(userId) },
  );
}

/**
 * Liga ou desliga os papéis profissionais de um membro.
 *
 * É a superfície que faltava: sem perfil de técnico de campo, a pessoa **não
 * pode ser atribuída** a um atendimento (`validateTechnicianAssignments` recusa)
 * e não aparece na lista de técnicos nem ganha comissão. O endpoint existia
 * desde o domínio profissional; a tela era somente leitura.
 *
 * Invalida a raiz do Workforce e as comissões: mudar quem é técnico muda quem
 * aparece na tabela de comissão.
 */
export function useUpdateProfessionalProfile(userId: string) {
  const invalidate = useWorkforceInvalidation();
  const client = useQueryClient();

  return useApiMutation(
    (input: UpdateProfessionalProfileInput) =>
      workforceService.updateProfessionalProfile(userId, input),
    {
      onSuccess: async () => {
        await invalidate();
        await client.invalidateQueries({
          queryKey: commissionsService.keys.all(),
        });
      },
      scope: { id: "professional-profile" },
    },
  );
}

export function useTeamRoles() {
  return useApiQuery(
    workforceService.keys.roles(),
    ({ signal }) => workforceService.roles({ signal }),
    WORKFORCE_REFRESH.roles,
  );
}

export function useAccessCatalog() {
  return useApiQuery(
    workforceService.keys.accessCatalog(),
    ({ signal }) => workforceService.accessCatalog({ signal }),
    WORKFORCE_REFRESH.roles,
  );
}

/* ------------------------------------------------------------------ */
/* Workforce — especialidades, certificações, equipes, geolocalização   */
/* ------------------------------------------------------------------ */

export function useSpecialties() {
  return useApiQuery(
    workforceService.keys.specialties(),
    ({ signal }) => workforceService.specialties({ signal }),
    WORKFORCE_REFRESH.specialties,
  );
}

export function useMemberSpecialties(userId?: string) {
  return useApiQuery(
    workforceService.keys.memberSpecialties(userId),
    ({ signal }) => workforceService.memberSpecialties(userId, { signal }),
    WORKFORCE_REFRESH.specialties,
  );
}

export function useCertifications(query?: CertificationQuery) {
  return useApiQuery(
    workforceService.keys.certifications(query),
    ({ signal }) => workforceService.certifications(query, { signal }),
    WORKFORCE_REFRESH.certifications,
  );
}

export function useTeams() {
  return useApiQuery(
    workforceService.keys.teams(),
    ({ signal }) => workforceService.teams({ signal }),
    WORKFORCE_REFRESH.teams,
  );
}

/**
 * Últimas posições da equipe.
 *
 * `withinMinutes` é recorte do **servidor**: uma coordenada de ontem não
 * responde "onde a equipe está agora", e é o backend que decide o que entra na
 * janela.
 */
export function useMemberLocations(withinMinutes = 240) {
  return useApiQuery(
    workforceService.keys.locations(withinMinutes),
    ({ signal }) => workforceService.locations(withinMinutes, { signal }),
    WORKFORCE_REFRESH.locations,
  );
}

export function useTeamInvitations(query?: InvitationQuery) {
  return useApiQuery(
    workforceService.keys.invitations(query),
    ({ signal }) => workforceService.invitations(query, { signal }),
    WORKFORCE_REFRESH.invitations,
  );
}

/* ------------------------------------------------------------------ */
/* Visão técnica — o que uma pessoa tem para fazer                      */
/* ------------------------------------------------------------------ */

/** Operações atribuídas — `assignedUserId` é filtro real. */
export function useMemberOperations(userId: string, limit = 5) {
  const query = { assignedUserId: userId, page: 1, limit } as const;
  return useApiQuery(
    operationsService.keys.list(query),
    ({ signal }) => operationsService.list(query, { signal }),
    WORKFORCE_REFRESH.related,
  );
}

/** Execuções sob responsabilidade — `responsibleUserId` é filtro real. */
export function useMemberExecutions(userId: string, limit = 5) {
  const query = { responsibleUserId: userId, page: 1, limit } as const;
  return useApiQuery(
    artifactExecutionsService.keys.list(query),
    ({ signal }) => artifactExecutionsService.list(query, { signal }),
    WORKFORCE_REFRESH.related,
  );
}

/**
 * Agenda da pessoa.
 *
 * Janela de 30 dias — recorte de apresentação. As ocorrências vêm expandidas
 * pelo motor de recorrência do backend; nada de conflito ou disponibilidade é
 * calculado aqui.
 */
export function useMemberSchedule(userId: string) {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + SCHEDULE_HORIZON_DAYS);

  const query = {
    userId,
    from: from.toISOString(),
    to: to.toISOString(),
  };

  return useApiQuery(
    schedulingService.keys.occurrences(query),
    ({ signal }) => schedulingService.occurrences(query, { signal }),
    WORKFORCE_REFRESH.related,
  );
}

/**
 * Contagem de um recorte, para os KPIs por pessoa.
 *
 * `limit: 1` e o número vem do `meta.total` do servidor — a mesma técnica do
 * Execution Center e do Catálogo, pelo mesmo motivo: **o Analytics não publica
 * indicadores por pessoa**, só `technicians.active` e
 * `technicians.assignment_coverage`, que são da organização.
 */
export function useMemberOperationsCount(
  userId: string,
  status?: OperationQuery["status"],
) {
  const query: OperationQuery = {
    assignedUserId: userId,
    status,
    page: 1,
    limit: 1,
  };
  const result = useApiQuery(
    operationsService.keys.list(query),
    ({ signal }) => operationsService.list(query, { signal }),
    WORKFORCE_REFRESH.related,
  );
  return {
    total: result.data?.meta.total,
    isPending: result.isPending,
    error: result.error,
  };
}

export function useMemberExecutionsCount(
  userId: string,
  status?: ArtifactExecutionQuery["status"],
) {
  const query: ArtifactExecutionQuery = {
    responsibleUserId: userId,
    status,
    page: 1,
    limit: 1,
  };
  const result = useApiQuery(
    artifactExecutionsService.keys.list(query),
    ({ signal }) => artifactExecutionsService.list(query, { signal }),
    WORKFORCE_REFRESH.related,
  );
  return {
    total: result.data?.meta.total,
    isPending: result.isPending,
    error: result.error,
  };
}

/* ------------------------------------------------------------------ */
/* Escritas                                                            */
/* ------------------------------------------------------------------ */

/**
 * Escritas de convite invalidam a lista de convites.
 *
 * **Não invalidam membros**: convidar não cria membro — quem cria é o
 * `accept`, feito pela pessoa convidada, noutra sessão. Derrubar o cache de
 * membros aqui seria recarregar por nada.
 */
function useInvitationInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: workforceService.keys.invitationsModule(),
    });
  };
}

export function useInviteMember() {
  const invalidate = useInvitationInvalidation();
  return useApiMutation(
    (input: CreateInvitationInput) => workforceService.invite(input),
    { onSuccess: invalidate },
  );
}

export function useResendInvitation() {
  const invalidate = useInvitationInvalidation();
  return useApiMutation((id: string) => workforceService.resendInvitation(id), {
    onSuccess: invalidate,
  });
}

export function useRevokeInvitation() {
  const invalidate = useInvitationInvalidation();
  return useApiMutation((id: string) => workforceService.revokeInvitation(id), {
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------------ */
/* Escritas — membros e papéis                                          */
/* ------------------------------------------------------------------ */

/**
 * Alterar membro derruba a lista de membros **e** a de papéis.
 *
 * A de papéis porque `memberCount` muda quando alguém troca de papel — sem
 * isso, a aba Papéis mostraria a contagem antiga até a próxima navegação.
 */
function useMemberInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: queryKeys.module("organizations-members"),
      }),
      queryClient.invalidateQueries({
        queryKey: workforceService.keys.members(),
      }),
      queryClient.invalidateQueries({
        queryKey: workforceService.keys.roles(),
      }),
    ]);
  };
}

export function useUpdateMember(userId: string) {
  const invalidate = useMemberInvalidation();
  return useApiMutation(
    (input: UpdateMemberInput) => workforceService.updateMember(userId, input),
    { onSuccess: invalidate, scope: { id: `member:${userId}` } },
  );
}

/* ------------------------------------------------------------------ */
/* Cadastro de pessoas                                                  */
/* ------------------------------------------------------------------ */

/**
 * Cadastra alguém da equipe.
 *
 * O resultado carrega a senha temporária e **não** é guardado em cache: a
 * resposta é mostrada uma vez e some com o diálogo. Uma senha em claro num
 * cache de consulta sobreviveria à navegação e ao devtools.
 */
export function useCreateTeamMember() {
  const invalidate = useMemberInvalidation();
  return useApiMutation(
    (input: CreateTeamMemberInput) => workforceService.createTeamMember(input),
    { onSuccess: invalidate },
  );
}

export function useIssuePasswordLink() {
  return useApiMutation((userId: string) =>
    workforceService.issuePasswordLink(userId),
  );
}

/** Desliga da organização — não confundir com sair de uma equipe. */
export function useDismissMember() {
  const invalidate = useMemberInvalidation();
  return useApiMutation(
    (userId: string) => workforceService.dismissMember(userId),
    { onSuccess: invalidate },
  );
}

function useRoleInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: workforceService.keys.roles(),
    });
  };
}

export function useCreateRole() {
  const invalidate = useRoleInvalidation();
  return useApiMutation(
    (input: CreateRoleInput) => workforceService.createRole(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateRole(id: string) {
  const invalidate = useRoleInvalidation();
  return useApiMutation(
    (input: UpdateRoleInput) => workforceService.updateRole(id, input),
    { onSuccess: invalidate, scope: { id: `role:${id}` } },
  );
}

export function useRemoveRole() {
  const invalidate = useRoleInvalidation();
  return useApiMutation((id: string) => workforceService.removeRole(id), {
    onSuccess: invalidate,
  });
}

/* ------------------------------------------------------------------ */
/* Escritas — workforce                                                 */
/* ------------------------------------------------------------------ */

/**
 * Uma invalidação para o módulo inteiro.
 *
 * Especialidade, certificação e equipe se cruzam: vincular uma especialidade
 * muda o `memberCount` do catálogo, e mexer numa equipe muda o que a lista de
 * equipes mostra. Derrubar o módulo é mais simples e mais correto que mapear
 * cada dependência — e o custo é baixo, porque são listas pequenas.
 */
function useWorkforceInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: workforceService.keys.workforceModule(),
    });
  };
}

export function useCreateSpecialty() {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: CreateSpecialtyInput) => workforceService.createSpecialty(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateSpecialty(id: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: UpdateSpecialtyInput) =>
      workforceService.updateSpecialty(id, input),
    { onSuccess: invalidate },
  );
}

export function useRemoveSpecialty() {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation((id: string) => workforceService.removeSpecialty(id), {
    onSuccess: invalidate,
  });
}

export function useAssignSpecialty(userId: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: AssignSpecialtyInput) =>
      workforceService.assignSpecialty(userId, input),
    { onSuccess: invalidate },
  );
}

export function useUnassignSpecialty(userId: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (specialtyId: string) =>
      workforceService.unassignSpecialty(userId, specialtyId),
    { onSuccess: invalidate },
  );
}

export function useCreateCertification(userId: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: CreateCertificationInput) =>
      workforceService.createCertification(userId, input),
    { onSuccess: invalidate },
  );
}

export function useUpdateCertification(id: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: UpdateCertificationInput) =>
      workforceService.updateCertification(id, input),
    { onSuccess: invalidate },
  );
}

export function useRemoveCertification() {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (id: string) => workforceService.removeCertification(id),
    { onSuccess: invalidate },
  );
}

export function useCreateTeam() {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: CreateTeamInput) => workforceService.createTeam(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateTeam(id: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: UpdateTeamInput) => workforceService.updateTeam(id, input),
    { onSuccess: invalidate, scope: { id: `team:${id}` } },
  );
}

export function useRemoveTeam() {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation((id: string) => workforceService.removeTeam(id), {
    onSuccess: invalidate,
  });
}

export function useAddTeamMember(teamId: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (input: AddTeamMemberInput) =>
      workforceService.addTeamMember(teamId, input),
    { onSuccess: invalidate, scope: { id: `team:${teamId}` } },
  );
}

export function useRemoveTeamMember(teamId: string) {
  const invalidate = useWorkforceInvalidation();
  return useApiMutation(
    (userId: string) => workforceService.removeTeamMember(teamId, userId),
    { onSuccess: invalidate, scope: { id: `team:${teamId}` } },
  );
}
