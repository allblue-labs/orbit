/**
 * As recusas da assinatura, com código público separado da mensagem interna.
 *
 * A mensagem daqui vai para o log e pode nomear estado e plano. A que chega ao
 * cliente vem do catálogo da PR-35, escolhida pelo código.
 */
import { HttpStatus } from '@nestjs/common';
import { BaseException } from '../../../exceptions';

export class SubscriptionNotFoundException extends BaseException {
  constructor(organizationId: string) {
    super(
      {
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: `No current subscription for organization ${organizationId}`,
      },
      HttpStatus.NOT_FOUND,
    );
  }
}

/**
 * A assinatura não autoriza usar o produto agora.
 *
 * `402`, e não `403`: a permissão existe — o que acabou foi o período. Era
 * `403`, e com ele a interface só sabia dizer "sem permissão", mandando a
 * pessoa procurar um administrador em vez de escolher um plano.
 *
 * O mesmo código de `SubscriptionExpiredException`, que é o caminho pelo qual
 * os guardas recusam: dois lugares chegam à mesma conclusão e a tela não
 * deveria precisar saber por qual deles passou.
 */
export class SubscriptionNotActiveException extends BaseException {
  constructor(status: string) {
    super(
      {
        code: 'SUBSCRIPTION_EXPIRED',
        message: `Subscription does not grant product access: ${status}`,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class SubscriptionInvalidTransitionException extends BaseException {
  constructor(from: string, to: string) {
    super(
      {
        code: 'SUBSCRIPTION_INVALID_TRANSITION',
        message: `Subscription transition not allowed: ${from} -> ${to}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class PlanChangeNotAllowedException extends BaseException {
  constructor(reason: string) {
    super(
      {
        code: 'PLAN_CHANGE_NOT_ALLOWED',
        message: `Plan change refused: ${reason}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/**
 * A recusa de avaliação — sempre igual, qualquer que seja o motivo.
 *
 * O motivo real fica no log. Publicar "este CNPJ já usou" transformaria o
 * endpoint num verificador de quem é cliente do Orbit, e um atacante com uma
 * lista de CNPJs faria a consulta que a Receita não faz.
 */
export class TrialNotEligibleException extends BaseException {
  constructor(readonly internalReason: string) {
    super(
      {
        code: 'TRIAL_NOT_ELIGIBLE',
        message: `Trial refused: ${internalReason}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}
