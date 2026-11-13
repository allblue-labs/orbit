import { AuthenticationService } from './authentication.service';
import { UnauthorizedException } from '../../../exceptions';

const user = {
  id: 'user',
  status: 'ACTIVE',
  deletedAt: null,
  isOrganizationOwner: true,
  effectiveBusinessUnitIds: [],
  platformRoleAssignments: [],
  organizationMemberships: [],
  credential: {
    id: 'credential',
    passwordHash: 'password-hash',
    failedAttempts: 0,
    lockedUntil: null,
  },
  mfaFactors: [{ id: 'factor' }],
};
const canonical = {
  accessToken: 'canonical-access',
  refreshToken: 'canonical-refresh',
  tokenType: 'Bearer',
  expiresIn: 900,
};
const session = {
  id: 'session',
  userId: 'user',
  client: 'MOBILE',
  refreshTokenHash: 'hash:old',
  inGrace: false,
  rotationResponse: null,
};
function setup() {
  const repository = {
    findRefreshSession: jest.fn().mockResolvedValue(session),
    findById: jest.fn().mockResolvedValue(user),
    findByEmail: jest.fn().mockResolvedValue(user),
    rotateSession: jest.fn().mockResolvedValue(true),
    revokeSession: jest.fn().mockResolvedValue(undefined),
    updateFailedLogin: jest.fn().mockResolvedValue(undefined),
    completeLogin: jest.fn().mockResolvedValue(undefined),
  };
  const tokens = {
    hashOpaqueToken: (value: string) => `hash:${value}`,
    issue: jest.fn().mockResolvedValue({
      ...canonical,
      refreshTokenHash: 'hash:canonical-refresh',
      expiresAt: new Date(Date.now() + 60_000),
    }),
  };
  const mfa = { verifyFactor: jest.fn().mockResolvedValue(undefined) };
  const crypto = { encrypt: (s: string) => s, decrypt: (s: string) => s };
  const service = new AuthenticationService(
    repository as never,
    tokens as never,
    mfa as never,
    { verify: jest.fn().mockResolvedValue(true) } as never,
    { generate: () => 'session' } as never,
    crypto as never,
  );
  return { repository, tokens, mfa, service };
}
describe('rotação e autenticação sem atualização de snapshots', () => {
  it('uma réplica que perde o CAS devolve somente o par persistido pela vencedora', async () => {
    const { service, repository } = setup();
    repository.rotateSession.mockResolvedValue(false);
    repository.findRefreshSession
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({
        ...session,
        inGrace: true,
        refreshTokenHash: 'hash:canonical-refresh',
        rotationResponse: JSON.stringify(canonical),
      });
    expect(await service.refresh('old')).toEqual(canonical);
    expect(repository.rotateSession).toHaveBeenCalledWith(
      'session',
      'hash:old',
      'hash:canonical-refresh',
      expect.any(Date),
      JSON.stringify(canonical),
    );
  });
  it('revogação concorrente ao CAS não devolve o candidato emitido', async () => {
    const { service, repository } = setup();
    repository.rotateSession.mockResolvedValue(false);
    repository.findRefreshSession
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(null);
    await expect(service.refresh('old')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });
  it('um cache corrompido é recusado e revogado', async () => {
    const { service, repository } = setup();
    repository.findRefreshSession.mockResolvedValue({
      ...session,
      inGrace: true,
      rotationResponse: JSON.stringify(canonical),
    });
    await expect(service.refresh('old')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    expect(repository.revokeSession).toHaveBeenCalledWith('session');
  });
  it('não usa grace para uma conta desativada', async () => {
    const { service, repository } = setup();
    repository.findRefreshSession.mockResolvedValue({
      ...session,
      inGrace: true,
      rotationResponse: JSON.stringify(canonical),
    });
    repository.findById.mockResolvedValue({ ...user, status: 'SUSPENDED' });
    await expect(service.refresh('old')).rejects.toThrow();
    expect(repository.revokeSession).toHaveBeenCalledWith('session');
  });
  it.each(['MFA_INVALID', 'MFA_REQUIRED'])(
    'contabiliza segundo fator incorreto, mas não o desafio ausente (%s)',
    async (code) => {
      const { service, mfa, repository } = setup();
      mfa.verifyFactor.mockRejectedValue(
        new UnauthorizedException('MFA', code),
      );
      await expect(
        service.login('email', 'password', 'code', { client: 'MOBILE' }),
      ).rejects.toMatchObject({ code });
      if (code === 'MFA_INVALID')
        expect(repository.updateFailedLogin).toHaveBeenCalledWith(
          'credential',
          'password-hash',
        );
      else expect(repository.updateFailedLogin).not.toHaveBeenCalled();
      expect(repository.completeLogin).not.toHaveBeenCalled();
    },
  );
  it('confere o hash usado na verificação antes de persistir o login', async () => {
    const { service, repository } = setup();
    await service.login('email', 'password', 'code', { client: 'MOBILE' });
    expect(repository.completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user', client: 'MOBILE' }),
      'credential',
      'password-hash',
    );
  });
});
