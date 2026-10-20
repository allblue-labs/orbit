import type { SendMailOptions } from 'nodemailer';
import { InfrastructureException } from '../../../exceptions';
import { IdentityTokenPurpose } from '../domain/identity.types';
import { SmtpIdentityTokenDelivery } from './identity-token.delivery';

class TestDelivery extends SmtpIdentityTokenDelivery {
  readonly messages: SendMailOptions[] = [];
  fail = false;

  protected override send(options: SendMailOptions): Promise<void> {
    this.messages.push(options);
    return this.fail
      ? Promise.reject(new Error('provider response with secret detail'))
      : Promise.resolve();
  }
}

describe('SmtpIdentityTokenDelivery', () => {
  const previousUrl = process.env.IDENTITY_PUBLIC_WEB_URL;
  const previousFrom = process.env.EMAIL_FROM;

  beforeEach(() => {
    process.env.IDENTITY_PUBLIC_WEB_URL = 'https://app.example.test';
    process.env.EMAIL_FROM = 'Orbit <no-reply@example.test>';
  });

  afterAll(() => {
    process.env.IDENTITY_PUBLIC_WEB_URL = previousUrl;
    process.env.EMAIL_FROM = previousFrom;
  });

  it.each([
    [IdentityTokenPurpose.INVITATION, '/convite'],
    [IdentityTokenPurpose.PASSWORD_RESET, '/redefinir-senha'],
  ] as const)('sends %s in the intended HTTPS flow', async (purpose, path) => {
    const delivery = new TestDelivery();

    await delivery.deliver(purpose, 'analyst@example.test', 'secret-token');

    expect(delivery.messages).toHaveLength(1);
    expect(delivery.messages[0]?.from).toBe('Orbit <no-reply@example.test>');
    expect(delivery.messages[0]?.to).toBe('analyst@example.test');
    expect(delivery.messages[0]?.text).toContain(
      `https://app.example.test${path}?token=secret-token`,
    );
  });

  it('normalizes provider failures without leaking token or provider detail', async () => {
    const delivery = new TestDelivery();
    delivery.fail = true;

    let failure: unknown;
    try {
      await delivery.deliver(
        IdentityTokenPurpose.PASSWORD_RESET,
        'analyst@example.test',
        'SENSITIVE_TOKEN_MUST_NOT_LEAK',
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(InfrastructureException);
    expect((failure as Error).message).toBe('Identity token delivery failed');
    expect((failure as Error).message).not.toContain(
      'SENSITIVE_TOKEN_MUST_NOT_LEAK',
    );
  });
});
