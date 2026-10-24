import { Prisma } from '@prisma/client';
import { registrationConflict } from './registration-conflicts';
import { PublicErrorMapper } from '../../../common/public-errors/public-error.mapper';

describe('registration conflicts', () => {
  it('classifies an organization name conflict when RLS hides its constraint fields', () => {
    const error = new Prisma.PrismaClientKnownRequestError('private message', {
      code: 'P2002',
      clientVersion: 'test',
      meta: {
        modelName: 'Organization',
        driverAdapterError: { cause: { kind: 'UniqueConstraintViolation' } },
      },
    });
    expect(registrationConflict(error)?.code).toBe(
      'REGISTRATION_ORGANIZATION_NAME_UNAVAILABLE',
    );
  });
  it.each([
    [['email'], 'REGISTRATION_EMAIL_ALREADY_EXISTS'],
    [['normalized_email'], 'REGISTRATION_EMAIL_ALREADY_EXISTS'],
    [['slug'], 'REGISTRATION_ORGANIZATION_NAME_UNAVAILABLE'],
  ])(
    'supports Prisma 7 adapter-pg nested constraint metadata: %j',
    (fields, code) => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'private message',
        {
          code: 'P2002',
          clientVersion: 'test',
          meta: { driverAdapterError: { cause: { constraint: { fields } } } },
        },
      );
      expect(registrationConflict(error)?.code).toBe(code);
    },
  );
  it.each([
    [['email'], 'REGISTRATION_EMAIL_ALREADY_EXISTS', 'e-mail'],
    [['normalized_email'], 'REGISTRATION_EMAIL_ALREADY_EXISTS', 'e-mail'],
    [
      'users_normalized_email_key',
      'REGISTRATION_EMAIL_ALREADY_EXISTS',
      'e-mail',
    ],
    [['slug'], 'REGISTRATION_ORGANIZATION_NAME_UNAVAILABLE', 'outro nome'],
    [undefined, 'REGISTRATION_CONFLICT', 'suporte'],
  ])(
    'classifies a unique constraint %j without exposing database errors',
    (target, code, copy) => {
      const error = new Prisma.PrismaClientKnownRequestError(
        'private query containing credentials',
        { code: 'P2002', clientVersion: 'test', meta: { target } },
      );
      const conflict = registrationConflict(error);
      expect(conflict?.code).toBe(code);
      const publicError = new PublicErrorMapper().map(conflict);
      expect(publicError).toMatchObject({ code, status: 409 });
      expect(publicError.message).toContain(copy);
      expect(JSON.stringify(publicError)).not.toMatch(
        /credentials|private query|P2002/,
      );
    },
  );
  it('does not turn an unrelated database failure into a duplicate account', () => {
    expect(registrationConflict(new Error('unavailable'))).toBeNull();
  });
});
