/**
 * A impressão digital da entidade contratante.
 *
 * ## Por que HMAC, e não SHA
 *
 * CPF tem 11 dígitos e CNPJ tem 14. O espaço inteiro cabe numa tabela: com um
 * SHA simples, quem obtivesse a coluna teria um dicionário reversível de todo
 * CNPJ que já testou o Orbit em algumas horas de GPU. O HMAC com segredo do
 * servidor quebra isso — sem a chave, a coluna não diz nada, e a chave nunca
 * entra no banco.
 *
 * ## Por que um segredo próprio
 *
 * `TRIAL_FINGERPRINT_SECRET` é dedicado. Reaproveitar o segredo do JWT ou a
 * chave de cifra acoplaria a rotação de um a rotação do outro: girar a chave
 * de sessões passaria a apagar a memória do antifraude, e ninguém perceberia
 * antes de os testes gratuitos duplicarem.
 *
 * ## O documento cru não vem para cá
 *
 * A organização já guarda o documento legal na unidade de negócio, com o
 * propósito de negócio dela. O registro antifraude precisa da impressão, não
 * de uma segunda cópia do dado sensível.
 */
import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { EnvironmentProvider } from '../../../providers/common.providers';
import { InfrastructureException } from '../../../exceptions';
import { normalizeBrazilianDocument } from '../../../utils';

/** Tamanho mínimo do segredo. Um segredo curto é o mesmo que nenhum. */
const TAMANHO_MINIMO = 32;

@Injectable()
export class TrialFingerprintService {
  constructor(private readonly environment: EnvironmentProvider) {}

  /**
   * A impressão do documento, em hexadecimal.
   *
   * Normaliza antes de assinar: `12.345.678/0001-95` e `12345678000195` são a
   * mesma empresa, e pontuação diferente não pode virar segundo teste grátis.
   */
  fingerprint(legalDocument: string): string {
    const normalizado = normalizeBrazilianDocument(legalDocument);
    if (normalizado.length !== 11 && normalizado.length !== 14) {
      throw new InfrastructureException(
        'Trial fingerprint requires a CPF or CNPJ',
      );
    }
    return createHmac('sha256', this.secret())
      .update(`orbit:trial:v1:${normalizado}`)
      .digest('hex');
  }

  /** Comparação em tempo constante, para não vazar por medida de tempo. */
  matches(fingerprint: string, other: string): boolean {
    const a = Buffer.from(fingerprint, 'hex');
    const b = Buffer.from(other, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private secret(): Buffer {
    const raw = this.environment.get('TRIAL_FINGERPRINT_SECRET');
    if (raw.trim().length < TAMANHO_MINIMO) {
      throw new InfrastructureException(
        `TRIAL_FINGERPRINT_SECRET must have at least ${TAMANHO_MINIMO} characters`,
      );
    }
    return Buffer.from(raw, 'utf8');
  }
}
