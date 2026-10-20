/**
 * Cria — ou reconcilia — um inquilino completo com um usuário **owner**, para
 * usar o sistema de ponta a ponta.
 *
 * ## Manual, e só manual
 *
 * Nada chama este script: nem o `docker-compose`, nem o `Dockerfile`, nem
 * qualquer `onModuleInit`. Ele existe para ser rodado à mão quando alguém
 * precisa de um acesso de teste:
 *
 * ```bash
 * npm run seed:owner:dev     # ts-node, ambiente local
 * npm run seed:owner         # a partir de dist/, ambiente construído
 * ```
 *
 * Um seed de acesso irrestrito que rodasse sozinho a cada subida seria uma
 * conta com todas as permissões nascendo em produção sem ninguém pedir.
 *
 * ## O que "todas as permissões" quer dizer aqui
 *
 * Autorização no Orbit tem duas camadas, e as duas precisam ser abertas:
 *
 * - **papel** → `Role.permissions`, conferido pelo `PermissionsGuard`;
 * - **plano** → `Plan.capabilities`, conferido pelo `CapabilityGuard`.
 *
 * O papel recebe `['*']`. O plano é um plano **próprio**, também com `['*']`,
 * em vez de uma alteração no `STARTER` — mexer no plano que os outros
 * inquilinos assinam mudaria o que todos eles podem fazer.
 *
 * O plano nasce **ativo**. A primeira versão o criava inativo, para não
 * aparecer no catálogo, na suposição de que só `listActive` olhava esse campo.
 * Não é o caso: o Dashboard resolve o contexto do inquilino e recusa plano
 * inativo, então toda a tela inicial respondia "organização não encontrada".
 * Um plano de teste visível no catálogo de um ambiente de desenvolvimento é
 * bem menos incômodo que um acesso que não abre o Dashboard.
 *
 * ## Idempotente
 *
 * Rodar de novo reconcilia: atualiza a senha, reabre a assinatura, garante os
 * vínculos. Não duplica organização nem unidade — e, se o usuário já existir
 * em **outra** organização, o script recusa em vez de mover a conta.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateUuidV7 } from '../utils';
import { ASSIGNABLE_TEAM_ROLES } from '../modules/organizations/team-roles';
import { RVT_MAINTENANCE_TYPE_SEEDS } from '../modules/rvt/rvt-maintenance-types.seed';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) {
    throw new Error(`Required environment variable ${key} is missing`);
  }
  return value;
};

const optional = (key: string, fallback: string): string =>
  process.env[key]?.trim() || fallback;

const PLAN_KEY = 'OWNER_FULL_ACCESS';

const email = required('OWNER_EMAIL').toLowerCase();
const password = required('OWNER_PASSWORD');
const firstName = required('OWNER_FIRST_NAME');
const lastName = required('OWNER_LAST_NAME');
const organizationName = optional('OWNER_ORGANIZATION_NAME', 'Orbit Owner');
const legalName = optional('OWNER_LEGAL_NAME', `${organizationName} LTDA`);
const city = optional('OWNER_CITY', 'Recife');
const street = optional('OWNER_STREET', 'Rua da Aurora');
const stateCode = optional('OWNER_STATE_CODE', 'PE').toUpperCase();

if (password.length < 12) {
  throw new Error('OWNER_PASSWORD must contain at least 12 characters');
}

/**
 * O banco exige CNPJ único por organização, e a aplicação valida o dígito.
 *
 * Sem um informado, gera-se um válido: o script precisa produzir um inquilino
 * que passe pelas mesmas regras de qualquer outro, não um caso especial.
 */
function generateCnpj(): string {
  const digits = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 10)).join('');
  const check = (numbers: string): number => {
    const weights =
      numbers.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = numbers
      .split('')
      .reduce(
        (total, digit, index) => total + Number(digit) * (weights[index] ?? 0),
        0,
      );
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  const base = `${digits(8)}0001`;
  const first = check(base);
  return `${base}${first}${check(`${base}${first}`)}`;
}

const documentNumber = optional('OWNER_DOCUMENT_NUMBER', generateCnpj());

const slugify = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80) || 'orbit-owner';

/**
 * A credencial administrativa, de propósito.
 *
 * O provisionamento cria organização, unidade e papel — nenhum deles existe
 * ainda para a RLS enxergar. Mesmo assim o script **declara o contexto** antes
 * de escrever, com os identificadores que acabou de gerar: é o mesmo caminho de
 * `RegistrationRepository`, e funciona igual sob papel restrito.
 */
const prisma = new PrismaClient({
  adapter: new PrismaPg(required('DATABASE_URL')),
});

type TransactionClient = Parameters<
  Parameters<PrismaClient['$transaction']>[0]
>[0];

const setLocal = (
  tx: TransactionClient,
  key: string,
  value: string,
): Promise<unknown> =>
  tx.$queryRawUnsafe('SELECT set_config($1, $2, true)', key, value);

async function seed(): Promise<void> {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const result = await prisma.$transaction(async (tx) => {
    /** Plano de acesso irrestrito para o inquilino de teste. */
    const plan = await tx.plan.upsert({
      where: { key: PLAN_KEY },
      create: {
        id: generateUuidV7(),
        key: PLAN_KEY,
        name: 'Acesso completo (teste)',
        description:
          'Plano de uso interno criado por npm run seed:owner. Não é vendável.',
        capabilities: ['*'],
        limits: {},
        isActive: true,
      },
      update: { capabilities: ['*'], limits: {}, isActive: true },
      select: { id: true },
    });

    const existing = await tx.user.findUnique({
      where: { normalizedEmail: email },
      select: {
        id: true,
        organizationMemberships: {
          where: { deletedAt: null },
          select: { organizationId: true, roleId: true },
          take: 1,
        },
      },
    });

    const userId = existing?.id ?? generateUuidV7();
    const membership = existing?.organizationMemberships[0] ?? null;

    /**
     * Conta que já pertence a um inquilino não é adotada por este script.
     *
     * Mover a pessoa para outra organização é uma decisão de negócio, não um
     * efeito colateral de rodar um seed — e a nova organização nasceria órfã.
     */
    if (existing && !membership) {
      throw new Error(
        `O usuário ${email} existe mas não tem organização. Resolva o vínculo antes de rodar este script.`,
      );
    }

    const organizationId = membership?.organizationId ?? generateUuidV7();
    /**
     * Sempre calculado, mesmo quando a organização já existe.
     *
     * O Prisma valida o payload inteiro do `upsert` antes de escolher o ramo,
     * então um `create` incompleto derruba a reconciliação — que é justamente
     * o caminho em que ele não seria usado.
     */
    const slug = `${slugify(organizationName)}-${organizationId.slice(-6)}`;

    const businessUnitId =
      (
        await tx.businessUnit.findFirst({
          where: { organizationId, deletedAt: null },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        })
      )?.id ?? generateUuidV7();

    await setLocal(tx, 'app.user_id', userId);
    await setLocal(tx, 'app.organization_id', organizationId);
    await setLocal(tx, 'app.business_unit_id', businessUnitId);
    await setLocal(tx, 'app.business_unit_ids', businessUnitId);

    const now = new Date();
    /** Assinatura longa: um acesso de teste que expira sozinho só atrapalha. */
    const periodEnd = new Date(now);
    periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 10);

    await tx.user.upsert({
      where: { id: userId },
      create: {
        id: userId,
        email,
        normalizedEmail: email,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`.trim(),
        status: 'ACTIVE',
        emailVerifiedAt: now,
        credential: { create: { passwordHash } },
      },
      update: {
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`.trim(),
        status: 'ACTIVE',
        emailVerifiedAt: now,
        credential: {
          upsert: {
            create: { passwordHash },
            update: {
              passwordHash,
              failedAttempts: 0,
              lockedUntil: null,
            },
          },
        },
      },
    });

    await tx.organization.upsert({
      where: { id: organizationId },
      create: {
        id: organizationId,
        ownerUserId: userId,
        planId: plan.id,
        slug,
        displayName: organizationName,
        primarySegment: 'HVACR',
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        subscriptionStartedAt: now,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      update: {
        planId: plan.id,
        status: 'ACTIVE',
        subscriptionStatus: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        deletedAt: null,
      },
    });

    await tx.businessUnit.upsert({
      where: { id: businessUnitId },
      create: {
        id: businessUnitId,
        organizationId,
        slug: `${slugify(organizationName)}-matriz`,
        isPrimary: true,
        type: 'HEADQUARTERS',
        legalName,
        tradeName: organizationName,
        documentType: 'CNPJ',
        documentNumber,
        city,
        street,
        stateCode,
      },
      update: { status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    /** Ownership authority comes from Organization.ownerUserId. */
    const ownerRole = await tx.role.findFirst({
      where: { organizationId, key: 'OWNER', deletedAt: null },
      select: { id: true },
    });
    const roleId = ownerRole?.id ?? generateUuidV7();
    await tx.role.upsert({
      where: { id: roleId },
      create: {
        id: roleId,
        organizationId,
        key: 'OWNER',
        name: 'Owner',
        description: 'Organization owner',
        permissions: [],
        allowedSurfaces: ['WEB', 'MOBILE'],
        isSystem: true,
      },
      update: {
        permissions: [],
        allowedSurfaces: ['WEB', 'MOBILE'],
        isSystem: true,
        deletedAt: null,
      },
      select: { id: true },
    });

    /**
     * O tenant manual precisa dos mesmos dados estruturais do cadastro real.
     * São papéis e cadências do produto, não pessoas/atendimentos de demo.
     */
    for (const role of ASSIGNABLE_TEAM_ROLES) {
      await tx.role.upsert({
        where: {
          organizationId_key: { organizationId, key: role.key },
        },
        create: {
          organizationId,
          key: role.key,
          name: role.name,
          description: role.description,
          permissions: [...role.permissions],
          allowedSurfaces: [...role.allowedSurfaces],
          isSystem: true,
        },
        update: {
          name: role.name,
          description: role.description,
          permissions: [...role.permissions],
          allowedSurfaces: [...role.allowedSurfaces],
          isSystem: true,
          deletedAt: null,
        },
        select: { id: true },
      });
    }

    for (const type of RVT_MAINTENANCE_TYPE_SEEDS) {
      await tx.rvtMaintenanceType.upsert({
        where: {
          organizationId_key: { organizationId, key: type.key },
        },
        create: {
          organizationId,
          key: type.key,
          label: type.label,
          intervalDays: type.intervalDays,
          intervalMonths: type.intervalMonths,
          sortOrder: type.sortOrder,
        },
        update: {
          label: type.label,
          intervalDays: type.intervalDays,
          intervalMonths: type.intervalMonths,
          sortOrder: type.sortOrder,
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      });
    }

    const organizationMembership = await tx.organizationMembership.findFirst({
      where: { organizationId, userId },
      select: { id: true },
    });
    if (organizationMembership) {
      await tx.organizationMembership.update({
        where: { id: organizationMembership.id },
        data: { roleId, status: 'ACTIVE', deletedAt: null },
      });
    } else {
      await tx.organizationMembership.create({
        data: { organizationId, userId, roleId },
      });
    }

    const unitMembership = await tx.businessUnitMembership.findFirst({
      where: { organizationId, businessUnitId, userId },
      select: { id: true },
    });
    if (unitMembership) {
      await tx.businessUnitMembership.update({
        where: { id: unitMembership.id },
        data: { roleId, status: 'ACTIVE', deletedAt: null },
      });
    } else {
      await tx.businessUnitMembership.create({
        data: { organizationId, businessUnitId, userId, roleId },
      });
    }

    /**
     * A conta de referência exercita os dois papéis profissionais.
     *
     * `OWNER_FULL_ACCESS` libera RBAC/capabilities, mas isso nao transforma a
     * pessoa em profissional: o aggregate exige um perfil ativo separado. Sem
     * este seed, a suíte Web só passava em bancos antigos que por acaso já
     * tinham esse perfil, e falhava num deploy realmente fresco ao consultar a
     * assinatura. O perfil continua sendo requisito de domínio; apenas o
     * inquilino interno de teste nasce completo e reproduzível.
     */
    await tx.professionalProfile.upsert({
      where: {
        organizationId_userId: { organizationId, userId },
      },
      create: {
        organizationId,
        userId,
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      },
      update: {
        fieldTechnicianEnabled: true,
        technicalResponsibleEnabled: true,
        active: true,
      },
      select: { id: true },
    });

    return {
      userId,
      organizationId,
      businessUnitId,
      created: !existing,
    };
  });

  console.log(
    JSON.stringify({
      stage: 'owner-seeded',
      outcome: result.created ? 'CREATED' : 'RECONCILED',
      email,
      userId: result.userId,
      organizationId: result.organizationId,
      businessUnitId: result.businessUnitId,
      planKey: PLAN_KEY,
      permissions: '*',
      capabilities: '*',
    }),
  );
  console.log(
    `\n[seed:owner] entre com ${email} e a senha de OWNER_PASSWORD.\n`,
  );
}

seed()
  .catch((error: unknown) => {
    console.error(
      `[seed:owner] falhou: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
