/**
 * As recusas da cobrança, com código público separado da causa interna.
 *
 * A causa pode nomear operação, tipo de erro do provedor e identificador de
 * configuração — tudo isso vai para o log. A mensagem pública vem do catálogo
 * da PR-35, escolhida pelo código: `No such price: price_1ABC` jamais chega ao
 * cliente, porque é um detalhe da nossa configuração e não da vida dele.
 */
import { HttpStatus } from '@nestjs/common';
import { BaseException } from '../../exceptions';

export class BillingNotConfiguredException extends BaseException {
  constructor() {
    super(
      {
        code: 'BILLING_NOT_CONFIGURED',
        message: 'Billing provider is disabled',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class BillingConfigurationInvalidException extends BaseException {
  constructor(readonly reason: string) {
    super(
      {
        code: 'BILLING_CONFIGURATION_INVALID',
        message: `Billing configuration invalid: ${reason}`,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

/**
 * O provedor não respondeu.
 *
 * Distinto de pagamento recusado, e a distinção é a mais importante deste
 * arquivo: tratar indisponibilidade como falha de cobrança suspenderia
 * clientes em dia num dia ruim do fornecedor.
 */
export class BillingProviderUnavailableException extends BaseException {
  constructor(readonly reason: string) {
    super(
      {
        code: 'BILLING_PROVIDER_UNAVAILABLE',
        message: `Billing provider unavailable: ${reason}`,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

export class BillingCheckoutNotAllowedException extends BaseException {
  constructor(readonly reason: string) {
    super(
      {
        code: 'BILLING_CHECKOUT_NOT_ALLOWED',
        message: `Checkout refused: ${reason}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class BillingCommandNotAllowedException extends BaseException {
  constructor(readonly reason: string) {
    super(
      {
        code: 'BILLING_COMMAND_NOT_ALLOWED',
        message: `Billing command refused: ${reason}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

export class BillingPaymentActionRequiredException extends BaseException {
  constructor() {
    super(
      {
        code: 'BILLING_PAYMENT_ACTION_REQUIRED',
        message: 'The payment method could not complete this billing change',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

export class BillingCustomerNotAvailableException extends BaseException {
  constructor(organizationId: string) {
    super(
      {
        code: 'BILLING_CUSTOMER_NOT_AVAILABLE',
        message: `No billing customer for organization ${organizationId}`,
      },
      HttpStatus.CONFLICT,
    );
  }
}

/** 400 e nada mais: um webhook sem assinatura válida não merece explicação. */
export class BillingWebhookInvalidException extends BaseException {
  constructor(readonly reason: string) {
    super(
      {
        code: 'BILLING_WEBHOOK_INVALID',
        message: `Webhook rejected: ${reason}`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
