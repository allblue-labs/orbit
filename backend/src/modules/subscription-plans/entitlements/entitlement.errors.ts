/**
 * As recusas do plano, com código público e mensagem interna separados.
 *
 * A mensagem que vai aqui dentro é para o log e para quem lê o rastro: pode
 * nomear o recurso interno. A que chega ao cliente vem do catálogo da PR-35,
 * escolhida pelo `code` — é por isso que `PLAN_LIMIT_REACHED` nunca sai como
 * `limit exceeded for PLATFORM_USERS`.
 */
import { HttpStatus } from '@nestjs/common';
import { BaseException } from '../../../exceptions';
import type {
  PlanCapability,
  PlanResource,
} from '../catalog/plan-catalog.types';

/** 403 — a organização não contratou a área. Não é falta de permissão. */
export class PlanCapabilityUnavailableException extends BaseException {
  constructor(readonly capability: PlanCapability) {
    super(
      {
        code: 'PLAN_CAPABILITY_NOT_AVAILABLE',
        message: `Plan capability not available: ${capability}`,
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

/** 409 — teto de quantidade simultânea (usuários, unidades, clientes…). */
export class PlanAllocationLimitReachedException extends BaseException {
  constructor(
    readonly resource: PlanResource,
    readonly current: number,
    readonly limit: number,
  ) {
    super(
      {
        code: 'PLAN_LIMIT_REACHED',
        message: `Plan allocation limit reached for ${resource}: ${current}/${limit}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/** 409 — teto mensal de uso (OS, documentos, automações). */
export class PlanUsageLimitReachedException extends BaseException {
  constructor(
    readonly resource: PlanResource,
    readonly current: number,
    readonly limit: number,
  ) {
    super(
      {
        code: 'PLAN_USAGE_LIMIT_REACHED',
        message: `Plan usage limit reached for ${resource}: ${current}/${limit}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * 500 — catálogo ou perfil mal configurado.
 *
 * Falha fechada de propósito: configuração inválida não pode virar recurso
 * ilimitado. Um teto que ninguém aplicou é pior do que uma requisição recusada.
 */
export class PlanConfigurationInvalidException extends BaseException {
  constructor(reason: string) {
    super(
      {
        code: 'PLAN_CONFIGURATION_INVALID',
        message: `Plan configuration invalid: ${reason}`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
