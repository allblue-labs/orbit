import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { assistsFieldWork, grantedAccessOf } from './field-eligibility';

const specialtyView = {
  id: true,
  name: true,
  slug: true,
  description: true,
  color: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { members: { where: { deletedAt: null } } } },
} satisfies Prisma.SpecialtySelect;

const teamView = {
  id: true,
  name: true,
  slug: true,
  description: true,
  color: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  businessUnit: { select: { id: true, legalName: true, tradeName: true } },
  leader: { select: { id: true, displayName: true } },
  members: {
    where: { deletedAt: null },
    select: {
      userId: true,
      role: true,
      joinedAt: true,
      user: {
        select: { id: true, displayName: true, email: true, avatarUrl: true },
      },
    },
    orderBy: { joinedAt: 'asc' },
  },
} satisfies Prisma.TeamSelect;

export const professionalProfileView = {
  id: true,
  organizationId: true,
  userId: true,
  fieldTechnicianEnabled: true,
  technicalResponsibleEnabled: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { displayName: true, status: true, deletedAt: true } },
  credentials: {
    where: { active: true, revokedAt: null },
    orderBy: { createdAt: 'desc' as const },
  },
  organization: { select: { id: true } },
} satisfies Prisma.ProfessionalProfileSelect;

@Injectable()
export class WorkforceRepository {
  constructor(private readonly rls: RlsTransaction) {}

  /* ---------------------------------------------------------------- */
  /* Especialidades                                                    */
  /* ---------------------------------------------------------------- */

  listSpecialties(organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.specialty.findMany({
        where: { organizationId, deletedAt: null },
        select: specialtyView,
        orderBy: { name: 'asc' },
      }),
    );
  }

  findSpecialty(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.specialty.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  createSpecialty(data: Prisma.SpecialtyUncheckedCreateInput) {
    return this.rls.run((transaction) =>
      transaction.specialty.create({ data, select: specialtyView }),
    );
  }

  updateSpecialty(id: string, data: Prisma.SpecialtyUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.specialty.update({
        where: { id },
        data,
        select: specialtyView,
      }),
    );
  }

  softDeleteSpecialty(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.specialty.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      )
      .then(() => undefined);
  }

  specialtyAssignments(id: string) {
    return this.rls.run((transaction) =>
      transaction.memberSpecialty.count({
        where: { specialtyId: id, deletedAt: null },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Especialidades de membros                                         */
  /* ---------------------------------------------------------------- */

  listMemberSpecialties(organizationId: string, userId?: string) {
    return this.rls.run((transaction) =>
      transaction.memberSpecialty.findMany({
        where: { organizationId, userId, deletedAt: null },
        select: {
          id: true,
          userId: true,
          level: true,
          notes: true,
          specialty: {
            select: { id: true, name: true, slug: true, color: true },
          },
        },
        orderBy: { specialty: { name: 'asc' } },
      }),
    );
  }

  /**
   * Vincula ou revive um vínculo.
   *
   * `@@unique([userId, specialtyId])` impede duplicidade, mas um vínculo
   * removido antes ainda ocupa a chave — daí o `upsert`, que revive em vez de
   * falhar com 409 por um registro que o usuário não vê.
   */
  upsertMemberSpecialty(input: {
    organizationId: string;
    userId: string;
    specialtyId: string;
    level: string;
    notes?: string;
  }) {
    return this.rls.run((transaction) =>
      transaction.memberSpecialty.upsert({
        where: {
          userId_specialtyId: {
            userId: input.userId,
            specialtyId: input.specialtyId,
          },
        },
        create: input,
        update: { level: input.level, notes: input.notes, deletedAt: null },
        select: {
          id: true,
          userId: true,
          level: true,
          notes: true,
          specialty: {
            select: { id: true, name: true, slug: true, color: true },
          },
        },
      }),
    );
  }

  removeMemberSpecialty(
    organizationId: string,
    userId: string,
    specialtyId: string,
  ) {
    return this.rls.run((transaction) =>
      transaction.memberSpecialty.updateMany({
        where: { organizationId, userId, specialtyId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Certificações                                                     */
  /* ---------------------------------------------------------------- */

  listCertifications(
    organizationId: string,
    query: { userId?: string; expiresBefore?: Date },
  ) {
    return this.rls.run((transaction) =>
      transaction.memberCertification.findMany({
        where: {
          organizationId,
          userId: query.userId,
          deletedAt: null,
          ...(query.expiresBefore
            ? { expiresAt: { not: null, lte: query.expiresBefore } }
            : {}),
        },
        orderBy: [{ expiresAt: 'asc' }, { name: 'asc' }],
      }),
    );
  }

  findCertification(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.memberCertification.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  createCertification(data: Prisma.MemberCertificationUncheckedCreateInput) {
    return this.rls.run((transaction) =>
      transaction.memberCertification.create({ data }),
    );
  }

  updateCertification(id: string, data: Prisma.MemberCertificationUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.memberCertification.update({ where: { id }, data }),
    );
  }

  softDeleteCertification(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.memberCertification.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      )
      .then(() => undefined);
  }

  /* ---------------------------------------------------------------- */
  /* Equipes                                                           */
  /* ---------------------------------------------------------------- */

  listTeams(organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.team.findMany({
        where: { organizationId, deletedAt: null },
        select: teamView,
        orderBy: { name: 'asc' },
      }),
    );
  }

  findTeam(id: string, organizationId: string) {
    return this.rls.run((transaction) =>
      transaction.team.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: teamView,
      }),
    );
  }

  createTeam(data: Prisma.TeamUncheckedCreateInput) {
    return this.rls.run((transaction) =>
      transaction.team.create({ data, select: teamView }),
    );
  }

  updateTeam(id: string, data: Prisma.TeamUpdateInput) {
    return this.rls.run((transaction) =>
      transaction.team.update({ where: { id }, data, select: teamView }),
    );
  }

  softDeleteTeam(id: string): Promise<void> {
    return this.rls
      .run((transaction) =>
        transaction.team.update({
          where: { id },
          data: { deletedAt: new Date() },
        }),
      )
      .then(() => undefined);
  }

  upsertTeamMembership(input: {
    organizationId: string;
    teamId: string;
    userId: string;
    role?: string;
  }) {
    return this.rls.run((transaction) =>
      transaction.teamMembership.upsert({
        where: {
          teamId_userId: { teamId: input.teamId, userId: input.userId },
        },
        create: input,
        update: { role: input.role, deletedAt: null },
      }),
    );
  }

  removeTeamMembership(teamId: string, userId: string) {
    return this.rls.run((transaction) =>
      transaction.teamMembership.updateMany({
        where: { teamId, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Geolocalização                                                    */
  /* ---------------------------------------------------------------- */

  createLocation(data: Prisma.MemberLocationUncheckedCreateInput) {
    return this.rls.run((transaction) =>
      transaction.memberLocation.create({ data }),
    );
  }

  /**
   * Última posição de cada pessoa dentro da janela.
   *
   * `distinct` sobre `userId` com ordenação por `recordedAt desc` devolve a
   * mais recente de cada um numa consulta só — sem trazer o histórico inteiro
   * para descartá-lo no servidor de aplicação.
   */
  latestLocations(organizationId: string, since: Date) {
    return this.rls.run((transaction) =>
      transaction.memberLocation.findMany({
        where: { organizationId, recordedAt: { gte: since } },
        distinct: ['userId'],
        orderBy: { recordedAt: 'desc' },
        select: {
          userId: true,
          latitude: true,
          longitude: true,
          accuracy: true,
          source: true,
          recordedAt: true,
          user: { select: { displayName: true } },
        },
      }),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Identidade profissional                                           */
  /* ---------------------------------------------------------------- */

  findProfessionalProfile(organizationId: string, userId: string) {
    return this.rls.run((tx) =>
      tx.professionalProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: professionalProfileView,
      }),
    );
  }

  /**
   * Quem pode acompanhar um atendimento como auxiliar.
   *
   * ## Por que não sai de `professional_profiles`
   *
   * Porque o auxiliar não é um profissional designado — ele lê o atendimento e
   * os documentos emitidos, e não executa nem assina nada. A pergunta aqui é de
   * vínculo e acesso: está ativo na organização, atua na unidade, e o acesso
   * dele abre o aplicativo de campo com leitura de atendimento.
   *
   * ## Por que o filtro não é do banco, e por que é daqui
   *
   * O acesso efetivo é o override do membro **ou** o do papel, e a escolha é por
   * linha. Expressar isso num `where` exigiria repetir a regra em SQL ao lado da
   * versão em TypeScript que o resto do módulo usa; a segunda cópia é a que
   * divergiria. A equipe de uma organização é pequena — é uma lista de pessoas,
   * não um histórico.
   *
   * O recorte fica **dentro** deste método, e não em quem o chama: há dois
   * chamadores — o seletor do formulário e a validação da atribuição — e um
   * deles aplicando a regra enquanto o outro confia na lista crua é um portão
   * aberto que o compilador não aponta.
   */
  async listFieldAssistantCandidates(
    organizationId: string,
    businessUnitId?: string,
  ) {
    const vinculos = await this.rls.run((tx) =>
      tx.organizationMembership.findMany({
        where: {
          organizationId,
          status: 'ACTIVE',
          deletedAt: null,
          user: {
            status: 'ACTIVE',
            deletedAt: null,
            ...(businessUnitId
              ? {
                  businessUnitMemberships: {
                    some: {
                      organizationId,
                      businessUnitId,
                      status: 'ACTIVE',
                      deletedAt: null,
                    },
                  },
                }
              : {}),
          },
        },
        select: {
          userId: true,
          usesCustomAccess: true,
          customPermissions: true,
          customAllowedSurfaces: true,
          role: { select: { permissions: true, allowedSurfaces: true } },
          user: { select: { displayName: true } },
        },
        orderBy: { user: { displayName: 'asc' } },
      }),
    );
    return vinculos.filter((vinculo) =>
      assistsFieldWork(grantedAccessOf(vinculo)),
    );
  }

  listProfessionals(
    organizationId: string,
    role: 'FIELD_TECHNICIAN' | 'TECHNICAL_RESPONSIBLE',
    businessUnitId?: string,
  ) {
    return this.rls.run((tx) =>
      tx.professionalProfile.findMany({
        where: {
          organizationId,
          active: true,
          ...(role === 'FIELD_TECHNICIAN'
            ? { fieldTechnicianEnabled: true }
            : { technicalResponsibleEnabled: true }),
          user: {
            status: 'ACTIVE',
            deletedAt: null,
            organizationMemberships: {
              some: { organizationId, status: 'ACTIVE', deletedAt: null },
            },
            ...(businessUnitId
              ? {
                  businessUnitMemberships: {
                    some: {
                      organizationId,
                      businessUnitId,
                      status: 'ACTIVE',
                      deletedAt: null,
                    },
                  },
                }
              : {}),
          },
        },
        select: {
          ...professionalProfileView,
          user: {
            select: { displayName: true, status: true, deletedAt: true },
          },
        },
        orderBy: { user: { displayName: 'asc' } },
      }),
    );
  }

  activeSignature(organizationId: string, userId: string) {
    return this.rls.run((tx) =>
      tx.userSignature.findFirst({
        where: { organizationId, userId, active: true, revokedAt: null },
        select: {
          id: true,
          storageObjectId: true,
          sha256: true,
          version: true,
        },
      }),
    );
  }

  activeSignatures(organizationId: string, userIds: string[]) {
    return this.rls.run((tx) =>
      tx.userSignature.findMany({
        where: {
          organizationId,
          userId: { in: userIds },
          active: true,
          revokedAt: null,
        },
        select: { userId: true },
      }),
    );
  }

  findStorageFile(organizationId: string, id: string) {
    return this.rls.run((tx) =>
      tx.storageFile.findFirst({
        where: { id, organizationId, deletedAt: null },
      }),
    );
  }

  activeMember(organizationId: string, userId: string) {
    return this.rls.run((tx) =>
      tx.organizationMembership.findFirst({
        where: { organizationId, userId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      }),
    );
  }

  upsertProfessionalProfile(
    organizationId: string,
    userId: string,
    actorId: string,
    data: {
      fieldTechnicianEnabled: boolean;
      technicalResponsibleEnabled: boolean;
      active: boolean;
    },
  ) {
    return this.rls.run(async (tx) => {
      const member = await tx.organizationMembership.findFirst({
        where: { organizationId, userId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      if (!member) return null;
      const before = await tx.professionalProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });
      const profile = await tx.professionalProfile.upsert({
        where: { organizationId_userId: { organizationId, userId } },
        create: { organizationId, userId, ...data },
        update: data,
        select: professionalProfileView,
      });
      await this.audit(
        tx,
        organizationId,
        actorId,
        'professional.role.updated',
        profile.id,
        before,
        data,
      );
      return profile;
    });
  }

  createCredential(
    organizationId: string,
    userId: string,
    actorId: string,
    data: {
      type: string;
      registrationNumber: string;
      region?: string;
      issuingAuthority?: string;
      displayLabel?: string;
    },
  ) {
    return this.rls.run(async (tx) => {
      const profile = await tx.professionalProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      });
      if (!profile) return null;
      const credential = await tx.professionalCredential.create({
        data: {
          organizationId,
          userId,
          professionalProfileId: profile.id,
          ...data,
        },
      });
      await this.audit(
        tx,
        organizationId,
        actorId,
        'professional.credential.updated',
        credential.id,
        null,
        { type: credential.type, active: true },
      );
      return credential;
    });
  }

  revokeCredential(organizationId: string, id: string, actorId: string) {
    return this.rls.run(async (tx) => {
      const current = await tx.professionalCredential.findFirst({
        where: { id, organizationId, active: true },
      });
      if (!current) return null;
      const credential = await tx.professionalCredential.update({
        where: { id },
        data: { active: false, revokedAt: new Date() },
      });
      await this.audit(
        tx,
        organizationId,
        actorId,
        'professional.credential.updated',
        id,
        { active: true },
        { active: false },
      );
      return credential;
    });
  }

  registerSignature(
    organizationId: string,
    userId: string,
    actorId: string,
    storageObjectId: string,
    sha256: string,
  ) {
    return this.rls.run(async (tx) => {
      const current = await tx.userSignature.findFirst({
        where: { organizationId, userId, active: true },
      });
      if (current)
        await tx.userSignature.update({
          where: { id: current.id },
          data: { active: false, revokedAt: new Date() },
        });
      const latest = await tx.userSignature.aggregate({
        where: { organizationId, userId },
        _max: { version: true },
      });
      const signature = await tx.userSignature.create({
        data: {
          organizationId,
          userId,
          storageObjectId,
          sha256,
          version: (latest._max.version ?? 0) + 1,
        },
      });
      await this.audit(
        tx,
        organizationId,
        actorId,
        'professional.signature.updated',
        signature.id,
        current ? { version: current.version } : null,
        { version: signature.version, signatureAvailable: true },
      );
      return signature;
    });
  }

  private audit(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actorId: string,
    action: string,
    entityId: string,
    before: unknown,
    after: unknown,
  ) {
    return tx.auditLog.create({
      data: {
        organizationId,
        userId: actorId,
        action,
        entityType: 'PROFESSIONAL_PROFILE',
        entityId,
        before: before
          ? (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue)
          : undefined,
        after: after
          ? (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue)
          : undefined,
      },
    });
  }
}
