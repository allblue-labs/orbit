/** Atualizar a versão sempre que houver alteração material no texto. */
export const LEGAL_DOCUMENT_VERSION = '2026-10-23.1';
export type LegalDocumentSlug = 'termos' | 'privacidade';
export interface LegalDocumentReadModel {
  slug: LegalDocumentSlug;
  title: string;
  version: string;
  effectiveAt: string;
  provider: {
    name: string;
    document: string;
    location: string;
    privacyEmail: string | null;
  };
  sections: readonly { title: string; paragraphs: readonly string[] }[];
}
