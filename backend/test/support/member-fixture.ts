import type { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';
import { randomUUID } from 'node:crypto';

/** A real non-owner, with authoritative database grants and a normal login. */
export async function memberFixture(
  prisma: PrismaClient,
  input: {
    organizationId: string;
    businessUnitIds: string[];
    permissions: string[];
    password: string;
  },
) {
  const suffix = randomUUID();
  const email = `fixture.member.${suffix}@orbit.local`;
  const passwordHash = await hash(input.password);
  return prisma.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        organizationId: input.organizationId,
        key: `FIXTURE_${suffix}`,
        name: 'Membro E2E',
        permissions: input.permissions,
      },
    });
    const user = await tx.user.create({
      data: {
        email,
        normalizedEmail: email,
        firstName: 'Membro',
        lastName: 'E2E',
        displayName: 'Membro E2E',
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        credential: { create: { passwordHash } },
        organizationMemberships: {
          create: { organizationId: input.organizationId, roleId: role.id },
        },
        businessUnitMemberships: {
          create: input.businessUnitIds.map((businessUnitId) => ({
            organizationId: input.organizationId,
            businessUnitId,
            roleId: role.id,
          })),
        },
      },
    });
    return { userId: user.id, email, roleId: role.id };
  });
}

/** A registered owner cannot be restricted by replacing its role alone. */
export async function replaceFixtureOwner(
  prisma: PrismaClient,
  organizationId: string,
  password: string,
) {
  const units = await prisma.businessUnit.findMany({
    where: { organizationId },
    select: { id: true },
  });
  const replacement = await memberFixture(prisma, {
    organizationId,
    businessUnitIds: units.map(({ id }) => id),
    permissions: ['*'],
    password,
  });
  await prisma.organization.update({
    where: { id: organizationId },
    data: { ownerUserId: replacement.userId },
  });
}
