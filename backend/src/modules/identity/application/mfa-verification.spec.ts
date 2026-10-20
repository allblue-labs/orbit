/**
 * A recusa do segundo fator precisa dizer **qual** é o problema.
 *
 * ## Por que isto tem teste
 *
 * A tela de login só revela o campo do código quando o servidor diz que ele
 * falta. Ela fazia isso comparando a mensagem interna em inglês, que o contrato
 * público nunca envia — resultado: quem ativava o segundo fator não conseguia
 * mais entrar, porque o campo nunca aparecia e a mensagem era "sua sessão não é
 * válida ou expirou".
 *
 * A correção é o cliente olhar o **código** do erro. Estes testes guardam os
 * dois códigos de que ele depende. Trocá-los é mudança de contrato, e quebra a
 * tela de login sem quebrar nada aqui perto.
 */
import { MfaService } from './mfa.service';
import { generateTotpToken } from '../../../utils/totp';
import type { IdentityRepository } from '../infrastructure/identity.repository';
import type { ICryptoProvider, IHashProvider } from '../../../contracts';
import { BaseException } from '../../../exceptions';

const SEGREDO = 'JBSWY3DPEHPK3PXP';

function montar(recoveryCodes: string[] = []) {
  const repository = {
    touchMfaFactor: jest.fn().mockResolvedValue(undefined),
    consumeMfaRecoveryCode: jest.fn().mockResolvedValue(undefined),
  };
  const crypto = {
    encrypt: (valor: string) => `cifrado:${valor}`,
    decrypt: (valor: string) => valor.replace('cifrado:', ''),
  };
  const hashes = {
    verify: jest.fn((hash: string, valor: string) =>
      Promise.resolve(hash === `hash:${valor}`),
    ),
  };
  const service = new MfaService(
    repository as unknown as IdentityRepository,
    crypto as unknown as ICryptoProvider,
    hashes as unknown as IHashProvider,
  );
  return {
    service,
    repository,
    factor: {
      id: 'factor-1',
      secret: `cifrado:${SEGREDO}`,
      recoveryCodes,
    },
  };
}

/** O código de erro publicado, que é o que o cliente lê. */
async function codigoDaRecusa(promessa: Promise<unknown>): Promise<string> {
  try {
    await promessa;
    throw new Error('esperava recusa');
  } catch (erro) {
    if (erro instanceof BaseException) return erro.code;
    throw erro;
  }
}

describe('verifyFactor', () => {
  it('pede o código com `MFA_REQUIRED` quando ele não vem', async () => {
    /* É este código que faz a tela de login revelar o campo. */
    const { service, factor } = montar();

    await expect(
      codigoDaRecusa(service.verifyFactor(factor, undefined)),
    ).resolves.toBe('MFA_REQUIRED');
  });

  it('recusa código errado com `MFA_INVALID`, e não com `UNAUTHORIZED`', async () => {
    /* "Sua sessão não é válida ou expirou" numa tela onde ninguém tem sessão
       fazia a pessoa trocar a senha. */
    const { service, factor } = montar();

    await expect(
      codigoDaRecusa(service.verifyFactor(factor, '000000')),
    ).resolves.toBe('MFA_INVALID');
  });

  it('aceita o código do autenticador e registra o uso', async () => {
    const { service, repository, factor } = montar();

    await expect(
      service.verifyFactor(factor, generateTotpToken(SEGREDO)),
    ).resolves.toBeUndefined();
    expect(repository.touchMfaFactor).toHaveBeenCalledWith('factor-1');
  });

  it('aceita código de recuperação e consome só o usado', async () => {
    const { service, repository, factor } = montar([
      'hash:AAA-111',
      'hash:BBB-222',
    ]);

    await service.verifyFactor(factor, 'BBB-222');

    expect(repository.consumeMfaRecoveryCode).toHaveBeenCalledWith('factor-1', [
      'hash:AAA-111',
    ]);
  });
});
