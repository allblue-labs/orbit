import { HttpStatus } from '@nestjs/common';
import { BaseException } from '../../exceptions';

/**
 * A assinatura não autoriza mais usar o produto.
 *
 * ## Por que 402, e não 403
 *
 * `403` diz "você não tem permissão", e a pessoa procura quem lhe dê uma. Aqui
 * a permissão existe: o que acabou foi o período pago. `402 Payment Required`
 * é o único código que separa as duas coisas, e a interface precisa dessa
 * distinção para oferecer a ação certa — escolher um plano, não pedir acesso
 * ao administrador.
 *
 * ## O que continua funcionando
 *
 * Tudo o que é leitura. Uma organização com a avaliação vencida continua
 * abrindo o histórico, consultando clientes e **baixando os documentos que já
 * emitiu** — eles são dela, foram produzidos durante o período pago, e
 * sequestrá-los para forçar a contratação seria cobrar com refém.
 *
 * O que para é criar, alterar e apagar. Ver `ActivePlanGuard`.
 */
export class SubscriptionExpiredException extends BaseException {
  constructor() {
    super(
      {
        code: 'SUBSCRIPTION_EXPIRED',
        message:
          'Sua assinatura está vencida. Escolha um plano para voltar a usar o Orbit.',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
