import { Prisma } from '@prisma/client';
import { ConflictException } from '../../../exceptions';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Só nomes de campos conhecidos viram códigos públicos; nunca o erro cru. */
export function registrationConflict(error: unknown): ConflictException | null {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return null;
  const driver = record(error.meta?.driverAdapterError);
  const constraint = record(record(driver?.cause)?.constraint);
  const target = error.meta?.target ?? constraint?.fields ?? constraint?.index;
  const fields = Array.isArray(target)
    ? target.filter((value): value is string => typeof value === 'string')
    : typeof target === 'string'
      ? [target]
      : [];
  if (
    fields.some((field) =>
      [
        'email',
        'normalizedEmail',
        'normalized_email',
        'users_email_key',
        'users_normalized_email_key',
      ].includes(field),
    )
  ) {
    return new ConflictException(
      'Registration email already exists',
      'REGISTRATION_EMAIL_ALREADY_EXISTS',
    );
  }
  if (
    fields.some((field) =>
      ['slug', 'organizations_slug_key'].includes(field),
    ) ||
    (fields.length === 0 && error.meta?.modelName === 'Organization')
  ) {
    // RLS pode ocultar os campos da restrição. No cadastro, o ID é gerado
    // internamente e slug é o único outro campo único de Organization.
    return new ConflictException(
      'Registration organization name unavailable',
      'REGISTRATION_ORGANIZATION_NAME_UNAVAILABLE',
    );
  }
  return new ConflictException(
    'Registration uniqueness conflict',
    'REGISTRATION_CONFLICT',
  );
}
