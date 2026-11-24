import { directDatabaseUrl } from './direct-database-url';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { generateUuidV7 } from '../utils';

config({ path: resolve(process.cwd(), '.env'), quiet: true });
config({ path: resolve(process.cwd(), '../.env'), quiet: true });

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value)
    throw new Error(`Required environment variable ${key} is missing`);
  return value;
};

const email = required('PLATFORM_ADMIN_EMAIL').toLowerCase();
const password = required('PLATFORM_ADMIN_PASSWORD');
const firstName = required('PLATFORM_ADMIN_FIRST_NAME');
const lastName = required('PLATFORM_ADMIN_LAST_NAME');
if (password.length < 12) {
  throw new Error(
    'PLATFORM_ADMIN_PASSWORD must contain at least 12 characters',
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg(directDatabaseUrl()),
});

async function seed() {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(
      'SELECT set_config($1, $2, true)',
      'app.is_platform_admin',
      'true',
    );
    let role = await tx.role.findFirst({
      where: { organizationId: null, key: 'PLATFORM_ADMIN', deletedAt: null },
    });
    role = role
      ? await tx.role.update({
          where: { id: role.id },
          data: {
            name: 'Platform Administrator',
            description: 'Global Orbit platform administration',
            permissions: ['*', 'platform.admin'],
            isSystem: true,
          },
        })
      : await tx.role.create({
          data: {
            id: generateUuidV7(),
            organizationId: null,
            key: 'PLATFORM_ADMIN',
            name: 'Platform Administrator',
            description: 'Global Orbit platform administration',
            permissions: ['*', 'platform.admin'],
            isSystem: true,
          },
        });

    let user = await tx.user.findUnique({ where: { normalizedEmail: email } });
    user = user
      ? await tx.user.update({
          where: { id: user.id },
          data: {
            email,
            firstName,
            lastName,
            displayName: `${firstName} ${lastName}`.trim(),
            status: 'ACTIVE',
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
            deletedAt: null,
          },
        })
      : await tx.user.create({
          data: {
            id: generateUuidV7(),
            email,
            normalizedEmail: email,
            firstName,
            lastName,
            displayName: `${firstName} ${lastName}`.trim(),
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
          },
        });
    await tx.$queryRawUnsafe(
      'SELECT set_config($1, $2, true)',
      'app.user_id',
      user.id,
    );
    await tx.credential.upsert({
      where: { userId: user.id },
      create: {
        id: generateUuidV7(),
        userId: user.id,
        passwordHash,
        mustChangePassword: false,
      },
      update: {
        passwordHash,
        passwordUpdatedAt: new Date(),
        mustChangePassword: false,
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
    await tx.platformRoleAssignment.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: {
        id: generateUuidV7(),
        userId: user.id,
        roleId: role.id,
      },
      update: { revokedAt: null },
    });
    await tx.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { userId: user.id, email: user.email, role: role.key };
  });
  process.stdout.write(
    `Platform administrator ready: ${result.email} (${result.userId}, ${result.role})\n`,
  );
}

seed()
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
