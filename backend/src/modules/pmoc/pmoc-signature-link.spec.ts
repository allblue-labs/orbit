import {
  HORAS_DE_VALIDADE,
  MOTIVO_DO_ESTADO,
  estadoDoLink,
  validadeDoLink,
} from './pmoc-signature-link';

const AGORA = new Date('2026-10-04T12:00:00.000Z');

const link = (patch: Partial<Parameters<typeof estadoDoLink>[0]> = {}) => ({
  expiresAt: new Date('2026-10-07T12:00:00.000Z'),
  revokedAt: null,
  signedAt: null,
  ...patch,
});

describe('o estado do link de assinatura', () => {
  it('dentro da validade, vale', () => {
    expect(estadoDoLink(link(), AGORA)).toBe('VALIDO');
  });

  it('passada a validade, expirou', () => {
    expect(estadoDoLink(link(), new Date('2026-10-08T12:00:00.000Z'))).toBe(
      'EXPIRADO',
    );
  });

  /** No instante exato o link já não vale: a validade é o limite, não o último ponto. */
  it('no instante do vencimento já não vale', () => {
    expect(estadoDoLink(link(), new Date('2026-10-07T12:00:00.000Z'))).toBe(
      'EXPIRADO',
    );
  });

  it('revogado é revogado', () => {
    expect(estadoDoLink(link({ revokedAt: AGORA }), AGORA)).toBe('REVOGADO');
  });

  /**
   * A ordem das verificações importa.
   *
   * Um contrato assinado na semana passada tem a validade vencida — e dizer
   * "expirado" faria o contratante achar que a assinatura dele não valeu. Assinado é
   * a verdade mais forte, e vem primeiro.
   */
  it('assinado vence a expiração', () => {
    expect(
      estadoDoLink(
        link({ signedAt: new Date('2026-10-05T12:00:00.000Z') }),
        new Date('2026-10-20T12:00:00.000Z'),
      ),
    ).toBe('JA_ASSINADO');
  });

  /** E vence a revogação: gerar um link novo não apaga a assinatura coletada. */
  it('assinado vence a revogação', () => {
    expect(
      estadoDoLink(link({ signedAt: AGORA, revokedAt: AGORA }), AGORA),
    ).toBe('JA_ASSINADO');
  });

  /** Revogado vence a expiração: substituído é substituído, não "venceu". */
  it('revogado vence a expiração', () => {
    expect(
      estadoDoLink(
        link({ revokedAt: AGORA }),
        new Date('2026-10-20T12:00:00.000Z'),
      ),
    ).toBe('REVOGADO');
  });
});

describe('o motivo mostrado ao contratante', () => {
  /**
   * Três situações, três frases.
   *
   * "Link inválido" para todas mandaria o contratante perguntar ao dono o que ele
   * mesmo podia ler na tela — e uma das três não é nem erro.
   */
  it('cada recusa tem a sua frase', () => {
    const frases = [
      MOTIVO_DO_ESTADO.EXPIRADO,
      MOTIVO_DO_ESTADO.REVOGADO,
      MOTIVO_DO_ESTADO.JA_ASSINADO,
    ];
    expect(new Set(frases).size).toBe(3);
    for (const frase of frases) expect(frase.length).toBeGreaterThan(20);
  });

  /** Expirado e substituído dizem o que fazer; já assinado diz que não há o que fazer. */
  it('as frases dizem o próximo passo', () => {
    expect(MOTIVO_DO_ESTADO.EXPIRADO).toMatch(/novo/i);
    expect(MOTIVO_DO_ESTADO.REVOGADO).toMatch(/último|recente/i);
    expect(MOTIVO_DO_ESTADO.JA_ASSINADO).toMatch(/nada mais/i);
  });

  /** Link válido não tem motivo: motivo é o que se diz ao recusar. */
  it('válido não tem frase', () => {
    expect(MOTIVO_DO_ESTADO.VALIDO).toBe('');
  });
});

describe('a validade', () => {
  it('são setenta e duas horas a partir de agora', () => {
    expect(validadeDoLink(AGORA).toISOString()).toBe(
      '2026-10-07T12:00:00.000Z',
    );
    expect(HORAS_DE_VALIDADE).toBe(72);
  });

  /** Atravessa o fim de semana: é quando o administrativo de uma empresa pequena para. */
  it('alcança o dia útil seguinte a um sábado', () => {
    const sabado = new Date('2026-10-03T18:00:00.000Z');
    expect(validadeDoLink(sabado).getTime()).toBeGreaterThan(
      new Date('2026-10-05T09:00:00.000Z').getTime(),
    );
  });
});
