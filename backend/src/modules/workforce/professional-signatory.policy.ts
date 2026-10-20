import { Injectable } from '@nestjs/common';
import type { ProfessionalRole } from './workforce.dto';

export const DOCUMENT_TYPES = [
  'SERVICE_ORDER',
  'RVT',
  'PMOC',
  'TECHNICAL_REPORT',
  'RECEIPT',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Política V2 explícita. Presença de technician/user/signature nunca decide. */
@Injectable()
export class ProfessionalSignatoryPolicy {
  allows(documentType: DocumentType, signedAs: ProfessionalRole): boolean {
    switch (documentType) {
      case 'SERVICE_ORDER':
        return signedAs === 'FIELD_TECHNICIAN';
      case 'RVT':
        return (
          signedAs === 'FIELD_TECHNICIAN' ||
          signedAs === 'TECHNICAL_RESPONSIBLE'
        );
      case 'PMOC':
      case 'TECHNICAL_REPORT':
        return signedAs === 'TECHNICAL_RESPONSIBLE';
      case 'RECEIPT':
        return false;
    }
  }
}
