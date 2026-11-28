import { ConflictException, BusinessException } from '../../exceptions';
import { CustomerServiceRequestPolicy } from './customer-service-request.policy';

describe('CustomerServiceRequestPolicy', () => {
  const policy = new CustomerServiceRequestPolicy();

  it('allows only explicit lifecycle transitions', () => {
    expect(() => policy.assertTransition('OPEN', 'IN_TRIAGE')).not.toThrow();
    expect(() =>
      policy.assertTransition('IN_TRIAGE', 'IN_PROGRESS'),
    ).not.toThrow();
    expect(() =>
      policy.assertTransition('IN_PROGRESS', 'RESOLVED'),
    ).not.toThrow();
    expect(() => policy.assertTransition('RESOLVED', 'IN_PROGRESS')).toThrow(
      BusinessException,
    );
  });

  it('rejects stale commands', () => {
    expect(() => policy.assertVersion(3, 2)).toThrow(ConflictException);
    expect(() => policy.assertVersion(3, 3)).not.toThrow();
  });

  it('keeps Portal cancellation before operational conversion only', () => {
    expect(policy.portalActions('OPEN', false)).toContain('CANCEL');
    expect(policy.portalActions('IN_TRIAGE', false)).toContain('CANCEL');
    expect(policy.portalActions('IN_PROGRESS', false)).not.toContain('CANCEL');
    expect(policy.portalActions('IN_PROGRESS', true)).toEqual([]);
    expect(() => policy.assertPortalCancellation('IN_TRIAGE', true)).toThrow(
      BusinessException,
    );
  });

  /**
   * Editar só antes da triagem — depois alguém já leu e decidiu pelo que
   * estava escrito. Responder enquanto o chamado está vivo; encerrado, não.
   */
  it('o cliente edita só antes da triagem e responde enquanto o chamado vive', () => {
    expect(policy.portalActions('OPEN', false)).toEqual([
      'EDIT',
      'REPLY',
      'CANCEL',
    ]);
    expect(policy.portalActions('IN_TRIAGE', false)).toEqual([
      'REPLY',
      'CANCEL',
    ]);
    expect(policy.portalActions('WAITING_CUSTOMER', false)).toEqual(['REPLY']);
    for (const encerrado of ['RESOLVED', 'REJECTED', 'CANCELLED'] as const)
      expect(policy.portalActions(encerrado, false)).toEqual([]);

    expect(() => policy.assertPortalEdit('OPEN', false)).not.toThrow();
    expect(() => policy.assertPortalEdit('IN_TRIAGE', false)).toThrow(
      BusinessException,
    );
    expect(() => policy.assertPortalEdit('OPEN', true)).toThrow(
      BusinessException,
    );
    expect(() =>
      policy.assertPortalReply('WAITING_CUSTOMER', false),
    ).not.toThrow();
    expect(() => policy.assertPortalReply('RESOLVED', false)).toThrow(
      BusinessException,
    );
  });

  it('exposes conversion only while the request is eligible', () => {
    expect(policy.internalActions('OPEN', false)).toContain('CREATE_OPERATION');
    expect(policy.internalActions('IN_PROGRESS', true)).not.toContain(
      'CREATE_OPERATION',
    );
  });
});
