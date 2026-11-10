/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { InfrastructureException } from '../../../exceptions';
import { IdentityTokenPurpose } from '../domain/identity.types';
import { TransactionalIdentityTokenDelivery } from './identity-token.delivery';
import type { EmailService } from '../../email/email.service';

const token = 'A'.repeat(64);
describe('TransactionalIdentityTokenDelivery', () => {
  const previous = process.env.IDENTITY_PUBLIC_WEB_URL;
  beforeEach(() => {
    process.env.IDENTITY_PUBLIC_WEB_URL = 'https://app.example.test';
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.IDENTITY_PUBLIC_WEB_URL;
    else process.env.IDENTITY_PUBLIC_WEB_URL = previous;
  });

  it.each([
    [IdentityTokenPurpose.INVITATION, '/convite?token=', 'Você foi convidado'],
    [
      IdentityTokenPurpose.PASSWORD_RESET,
      '/redefinir-senha?token=',
      'Redefinição de senha',
    ],
    [
      IdentityTokenPurpose.EMAIL_VERIFICATION,
      '/confirmar-email#token=',
      'Bem-vindo ao Orbit',
    ],
  ] as const)(
    'envia %s pela classe central com texto e HTML em português',
    async (purpose, path, subject) => {
      const email = {
        send: jest.fn().mockResolvedValue({ status: 'SENT', provider: 'ses' }),
      };
      await new TransactionalIdentityTokenDelivery(
        email as unknown as EmailService,
      ).deliver(purpose, 'user@example.test', token);
      expect(email.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'user@example.test',
          subject: expect.stringContaining(subject),
          text: expect.stringContaining(
            `https://app.example.test${path}${token}`,
          ),
          html: expect.stringContaining('lang="pt-BR"'),
        }),
      );
    },
  );
  it('normaliza falhas sem incluir detalhes ou tokens na exceção', async () => {
    const email = {
      send: jest.fn().mockResolvedValue({
        status: 'FAILED',
        provider: 'ses',
        code: 'SES_MESSAGE_REJECTED',
      }),
    };
    await expect(
      new TransactionalIdentityTokenDelivery(
        email as unknown as EmailService,
      ).deliver(
        IdentityTokenPurpose.PASSWORD_RESET,
        'user@example.test',
        token,
      ),
    ).rejects.toThrow(
      new InfrastructureException('Identity token delivery failed'),
    );
  });
});
