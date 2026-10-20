import { createHash } from 'node:crypto';
import { InfrastructureException } from '../../../exceptions';
import { TrialFingerprintService } from './trial-fingerprint';

const SEGREDO = 'a'.repeat(48);
const OUTRO_SEGREDO = 'b'.repeat(48);

const comSegredo = (valor: string) =>
  new TrialFingerprintService({
    get: () => valor,
    getOptional: () => valor,
  });

describe('impressão digital da entidade contratante', () => {
  const service = comSegredo(SEGREDO);
  const CNPJ = '12345678000195';

  it('normaliza a pontuação antes de assinar', () => {
    // Mudar a pontuação não pode virar um segundo teste grátis.
    expect(service.fingerprint('12.345.678/0001-95')).toBe(
      service.fingerprint(CNPJ),
    );
    expect(service.fingerprint(' 12345678000195 ')).toBe(
      service.fingerprint(CNPJ),
    );
  });

  it('é determinística', () => {
    expect(service.fingerprint(CNPJ)).toBe(service.fingerprint(CNPJ));
  });

  it('documentos diferentes têm impressões diferentes', () => {
    expect(service.fingerprint(CNPJ)).not.toBe(
      service.fingerprint('98765432000198'),
    );
  });

  it('segredo diferente produz impressão diferente', () => {
    // É o que separa HMAC de hash: sem a chave, a coluna não diz nada.
    expect(comSegredo(OUTRO_SEGREDO).fingerprint(CNPJ)).not.toBe(
      service.fingerprint(CNPJ),
    );
  });

  it('não é um SHA simples do documento', () => {
    // CPF e CNPJ são enumeráveis: um SHA desta coluna seria um dicionário
    // reversível de quem já testou o Orbit.
    const ingenuos = [
      createHash('sha256').update(CNPJ).digest('hex'),
      createHash('sha256').update('12.345.678/0001-95').digest('hex'),
      createHash('sha1').update(CNPJ).digest('hex'),
      createHash('md5').update(CNPJ).digest('hex'),
    ];
    expect(ingenuos).not.toContain(service.fingerprint(CNPJ));
  });

  it('não contém o documento em lugar nenhum', () => {
    const impressao = service.fingerprint(CNPJ);
    expect(impressao).not.toContain(CNPJ);
    expect(impressao).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compara em tempo constante', () => {
    const impressao = service.fingerprint(CNPJ);
    expect(service.matches(impressao, impressao)).toBe(true);
    expect(service.matches(impressao, service.fingerprint('11144477735'))).toBe(
      false,
    );
  });

  it('aceita CPF e CNPJ, e recusa o resto', () => {
    expect(service.fingerprint('11144477735')).toMatch(/^[0-9a-f]{64}$/);
    for (const invalido of ['123', '', '1234567890123456789']) {
      expect(() => service.fingerprint(invalido)).toThrow(
        InfrastructureException,
      );
    }
  });

  it('recusa segredo curto demais', () => {
    expect(() => comSegredo('curto').fingerprint(CNPJ)).toThrow(
      InfrastructureException,
    );
  });
});
