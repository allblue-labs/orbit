/**
 * Cada recusa do login diz o que aconteceu.
 *
 * ## Por que isto tem teste
 *
 * As três recusas saíam com o mesmo código, `UNAUTHORIZED`, e a mesma frase:
 * "Sua sessão não é válida ou expirou" — dita a quem está na tela de login, onde
 * ninguém tem sessão. Quem errou a senha ficava limpando cookie; quem estava com
 * a conta travada continuava digitando a senha certa; e quem tinha ativado o
 * segundo fator não descobria que faltava o código.
 *
 * Isso custou uma investigação inteira: a mensagem de senha errada é
 * indistinguível da de sessão expirada, e foi ela que mandou procurar o defeito
 * no lugar errado.
 *
 * Os códigos são contrato publicado, e a tela decide por eles.
 */
import { AuthenticationService } from './authentication.service';
import { BaseException } from '../../../exceptions';

const SESSION = { client: 'WEB' as const };

function montar(
  overrides: {
    user?: Record<string, unknown> | null;
    passwordValid?: boolean;
  } = {},
) {
  const user =
    overrides.user === undefined
      ? {
          id: 'user-1',
          status: 'ACTIVE',
          deletedAt: null,
          credential: {
            id: 'cred-1',
            passwordHash: 'hash',
            failedAttempts: 0,
            lockedUntil: null,
          },
          mfaFactors: [],
          organizationMemberships: [],
          businessUnitMemberships: [],
          platformRoleAssignments: [],
        }
      : overrides.user;

  const repository = {
    findByEmail: jest.fn().mockResolvedValue(user),
    updateFailedLogin: jest.fn().mockResolvedValue(undefined),
    createSession: jest.fn().mockResolvedValue(undefined),
  };

  const hashes = {
    verify: jest.fn().mockResolvedValue(overrides.passwordValid ?? true),
  };

  /* A ordem é a do construtor: repositório, tokens, MFA, hashes, uuids. */
  const service = new AuthenticationService(
    repository as never,
    { issue: jest.fn().mockResolvedValue({}) } as never,
    { verifyFactor: jest.fn() } as never,
    hashes as never,
    { generate: () => 'session-1' } as never,
  );

  return { service, repository };
}

/** O código publicado da recusa — o que o cliente lê. */
async function codigoDaRecusa(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
    throw new Error('esperava recusa');
  } catch (erro) {
    if (erro instanceof BaseException) return erro.code;
    throw erro;
  }
}

describe('recusas do login', () => {
  it('senha errada é INVALID_CREDENTIALS, e não sessão expirada', async () => {
    const { service } = montar({ passwordValid: false });

    await expect(
      codigoDaRecusa(service.login('a@b.com', 'errada', undefined, SESSION)),
    ).resolves.toBe('INVALID_CREDENTIALS');
  });

  it('e-mail que não existe recebe a mesma recusa da senha errada', async () => {
    /* A diferença entre as duas só interessa a quem está sondando endereços. */
    const { service } = montar({ user: null });

    await expect(
      codigoDaRecusa(service.login('nao@existe.com', 'x', undefined, SESSION)),
    ).resolves.toBe('INVALID_CREDENTIALS');
  });

  it('conta desativada não se distingue de credencial errada', async () => {
    const { service } = montar({
      user: {
        id: 'user-1',
        status: 'SUSPENDED',
        deletedAt: null,
        credential: {
          id: 'cred-1',
          passwordHash: 'hash',
          failedAttempts: 0,
          lockedUntil: null,
        },
        mfaFactors: [],
      },
    });

    await expect(
      codigoDaRecusa(service.login('a@b.com', 'certa', undefined, SESSION)),
    ).resolves.toBe('INVALID_CREDENTIALS');
  });

  it('conta travada é ACCOUNT_LOCKED, para a pessoa saber que é só esperar', async () => {
    /* Com "e-mail ou senha incorretos", quem está travado digita a senha certa e
       recebe erro sem nenhuma pista. */
    const { service } = montar({
      user: {
        id: 'user-1',
        status: 'ACTIVE',
        deletedAt: null,
        credential: {
          id: 'cred-1',
          passwordHash: 'hash',
          failedAttempts: 0,
          lockedUntil: new Date(Date.now() + 60_000),
        },
        mfaFactors: [],
      },
    });

    await expect(
      codigoDaRecusa(service.login('a@b.com', 'certa', undefined, SESSION)),
    ).resolves.toBe('ACCOUNT_LOCKED');
  });

  it('trava vencida deixa entrar', async () => {
    const { service } = montar({
      user: {
        id: 'user-1',
        status: 'ACTIVE',
        deletedAt: null,
        credential: {
          id: 'cred-1',
          passwordHash: 'hash',
          failedAttempts: 0,
          lockedUntil: new Date(Date.now() - 60_000),
        },
        mfaFactors: [],
        organizationMemberships: [],
        businessUnitMemberships: [],
        platformRoleAssignments: [],
      },
    });

    /* Não recusa por trava: segue o fluxo e falha adiante, onde os colaboradores
       são falsos. O que este teste guarda é que a trava expirada não barra. */
    await expect(
      codigoDaRecusa(service.login('a@b.com', 'certa', undefined, SESSION)),
    ).resolves.not.toBe('ACCOUNT_LOCKED');
  });
});
