import { Injectable } from '@nestjs/common';
import { BusinessException, ConflictException } from '../../exceptions';
import type {
  CustomerServiceRequestAction,
  CustomerServiceRequestStatus,
} from './customer-service-request.types';

const transitions: Record<
  CustomerServiceRequestStatus,
  CustomerServiceRequestStatus[]
> = {
  OPEN: ['IN_TRIAGE', 'IN_PROGRESS', 'RESOLVED', 'REJECTED', 'CANCELLED'],
  IN_TRIAGE: [
    'IN_PROGRESS',
    'WAITING_CUSTOMER',
    'RESOLVED',
    'REJECTED',
    'CANCELLED',
  ],
  IN_PROGRESS: ['WAITING_CUSTOMER', 'RESOLVED', 'REJECTED'],
  WAITING_CUSTOMER: ['IN_PROGRESS', 'RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: [],
  CANCELLED: [],
};

@Injectable()
export class CustomerServiceRequestPolicy {
  assertVersion(actual: number, expected: number): void {
    if (actual !== expected) {
      throw new ConflictException(
        'Customer service request version is stale',
        'STALE_VERSION',
      );
    }
  }

  assertTransition(
    from: CustomerServiceRequestStatus,
    to: CustomerServiceRequestStatus,
  ): void {
    if (!transitions[from].includes(to)) {
      throw new BusinessException(
        `Transition ${from} -> ${to} is not allowed`,
        'INVALID_STATUS_TRANSITION',
      );
    }
  }

  assertPortalCancellation(
    status: CustomerServiceRequestStatus,
    converted: boolean,
  ): void {
    if (converted || !['OPEN', 'IN_TRIAGE'].includes(status)) {
      throw new BusinessException(
        'This request can no longer be cancelled',
        'CANCELLATION_NOT_ALLOWED',
      );
    }
  }

  assertConvertible(
    status: CustomerServiceRequestStatus,
    converted: boolean,
  ): void {
    if (converted || !['OPEN', 'IN_TRIAGE'].includes(status)) {
      throw new BusinessException(
        'This request cannot be converted into an Operation',
        'CONVERSION_NOT_ALLOWED',
      );
    }
  }

  /**
   * O que o cliente pode fazer agora — a mesma regra do trigger do banco.
   *
   * Editar só antes da triagem: depois disso alguém já leu e decidiu com base
   * no que estava escrito. Responder enquanto o chamado estiver vivo. Cancelar
   * enquanto ninguém começou.
   */
  portalActions(
    status: CustomerServiceRequestStatus,
    converted: boolean,
  ): CustomerServiceRequestAction[] {
    /* Convertido, o chamado virou atendimento: a conversa segue por lá. */
    if (converted) return [];
    const acoes: CustomerServiceRequestAction[] = [];
    if (status === 'OPEN') acoes.push('EDIT');
    if (
      ['OPEN', 'IN_TRIAGE', 'IN_PROGRESS', 'WAITING_CUSTOMER'].includes(status)
    )
      acoes.push('REPLY');
    if (['OPEN', 'IN_TRIAGE'].includes(status)) acoes.push('CANCEL');
    return acoes;
  }

  assertPortalEdit(
    status: CustomerServiceRequestStatus,
    converted: boolean,
  ): void {
    if (converted || status !== 'OPEN') {
      throw new BusinessException(
        'Este chamado já foi analisado pela equipe e não pode mais ser editado. Envie uma mensagem no chamado.',
        'SERVICE_REQUEST_NOT_EDITABLE',
      );
    }
  }

  assertPortalReply(
    status: CustomerServiceRequestStatus,
    converted: boolean,
  ): void {
    if (
      converted ||
      !['OPEN', 'IN_TRIAGE', 'IN_PROGRESS', 'WAITING_CUSTOMER'].includes(status)
    ) {
      throw new BusinessException(
        'Este chamado está encerrado. Abra um novo chamado se precisar.',
        'SERVICE_REQUEST_CLOSED',
      );
    }
  }

  internalActions(
    status: CustomerServiceRequestStatus,
    converted: boolean,
  ): CustomerServiceRequestAction[] {
    const common: CustomerServiceRequestAction[] = [
      'ASSIGN',
      'ADD_PUBLIC_RESPONSE',
      'ADD_INTERNAL_NOTE',
    ];
    if (transitions[status].includes('IN_TRIAGE')) common.push('TRIAGE');
    if (transitions[status].includes('IN_PROGRESS'))
      common.push('MARK_IN_PROGRESS');
    if (transitions[status].includes('WAITING_CUSTOMER'))
      common.push('WAIT_FOR_CUSTOMER');
    if (transitions[status].includes('RESOLVED')) common.push('RESOLVE');
    if (transitions[status].includes('REJECTED')) common.push('REJECT');
    if (!converted && ['OPEN', 'IN_TRIAGE'].includes(status))
      common.push('CREATE_OPERATION');
    return common;
  }
}
