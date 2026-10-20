import { Injectable } from '@nestjs/common';
import type { MobileNotificationType } from './mobile-device.read-models';

export interface MobileNotificationIntent {
  organizationId: string;
  businessUnitId: string | null;
  recipientUserId: string;
  type: MobileNotificationType;
  factId: string;
  resourceId: string;
  correlationId: string;
}

export interface ResolvedMobileNotification {
  dedupeKey: string;
  title: string;
  body: string;
  deepLink: string;
}

@Injectable()
export class MobileNotificationPolicy {
  resolve(intent: MobileNotificationIntent): ResolvedMobileNotification {
    const base = `${intent.type}:${intent.factId}:${intent.recipientUserId}`;
    switch (intent.type) {
      case 'WORK_ASSIGNED':
        return {
          dedupeKey: base,
          title: 'Novo atendimento atribuído',
          body: 'Abra o Orbit para consultar os detalhes atualizados.',
          deepLink: `/field/work-items/OPERATION:${intent.resourceId}`,
        };
      case 'ARTIFACT_AVAILABLE':
        return {
          dedupeKey: base,
          title: 'Documento disponível',
          body: 'O documento solicitado já pode ser consultado no Orbit.',
          deepLink: `/field/artifacts/${intent.resourceId}`,
        };
      case 'SYNC_ATTENTION_REQUIRED':
        return {
          dedupeKey: base,
          title: 'Sincronização requer atenção',
          body: 'Abra o Orbit para revisar uma pendência de sincronização.',
          deepLink: '/field/sync',
        };
    }
  }
}
