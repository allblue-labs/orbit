/**
 * Acompanha os papéis de sistema gravados em cada organização ao catálogo.
 *
 * Roda no mesmo passo do deploy que migra o banco e reconcilia os catálogos de
 * planos e de modelos de documento: é o mesmo problema — dado semeado que
 * envelhece quando o código muda — e merece a mesma porta.
 *
 * Só acrescenta. O que sobra é registrado no log; ver `reconcileRole`.
 */
import { directDatabaseUrl } from './direct-database-url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { ASSIGNABLE_TEAM_ROLES } from '../modules/organizations/team-roles';
import { reconcileRole } from '../modules/organizations/team-role-reconciliation';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const databaseUrl = directDatabaseUrl();

const prisma = new PrismaClient({ adapter: new PrismaPg(databaseUrl) });

async function main(): Promise<void> {
  const catalogo = new Map(
    ASSIGNABLE_TEAM_ROLES.map((role) => [role.key, role]),
  );

  const resultado = await prisma.$transaction(async (tx) => {
    /* Os papéis vivem atrás de RLS por organização; reconciliar todas é ato da
       plataforma. */
    await tx.$queryRaw`SELECT set_config('app.is_platform_admin', 'true', true)`;

    const gravados = await tx.role.findMany({
      where: {
        isSystem: true,
        organizationId: { not: null },
        key: { in: [...catalogo.keys()] },
      },
      select: {
        id: true,
        key: true,
        organizationId: true,
        permissions: true,
        allowedSurfaces: true,
      },
    });

    let atualizados = 0;
    const sobras: {
      key: string;
      organizationId: string | null;
      extra: string[];
    }[] = [];
    for (const papel of gravados) {
      const referencia = catalogo.get(papel.key);
      if (!referencia) continue;
      const ajuste = reconcileRole(referencia, papel);
      if (ajuste.extraPermissions.length)
        sobras.push({
          key: papel.key,
          organizationId: papel.organizationId,
          extra: ajuste.extraPermissions,
        });
      if (!ajuste.permissions && !ajuste.allowedSurfaces) continue;
      await tx.role.update({
        where: { id: papel.id },
        data: {
          ...(ajuste.permissions ? { permissions: ajuste.permissions } : {}),
          ...(ajuste.allowedSurfaces
            ? { allowedSurfaces: ajuste.allowedSurfaces }
            : {}),
        },
      });
      atualizados += 1;
    }
    return { avaliados: gravados.length, atualizados, sobras };
  });

  console.log(
    `[team-roles] ${resultado.avaliados} papel(éis) de sistema avaliado(s), ` +
      `${resultado.atualizados} atualizado(s) com o que faltava do catálogo.`,
  );
  if (resultado.sobras.length) {
    /* Relatado e não retirado: revogar acesso não é efeito colateral de deploy. */
    console.warn(
      JSON.stringify({
        stage: 'team-roles-extra-permissions',
        roles: resultado.sobras.length,
        sample: resultado.sobras.slice(0, 5),
      }),
    );
  }
}

main()
  .catch((error: unknown) => {
    console.error('[team-roles] falhou', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
