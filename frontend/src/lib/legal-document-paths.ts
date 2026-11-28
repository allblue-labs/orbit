import type { LegalDocumentSlug } from "@/types/contracts/modules/legal/legal.read-models";

export function legalDocumentHref(slug: LegalDocumentSlug, version?: string) {
  return `/legal/${slug}${version ? "/" + encodeURIComponent(version) : ""}`;
}

export function legalDocumentDownloadHref(
  slug: LegalDocumentSlug,
  version?: string,
) {
  return `/api/legal/${slug}/download${version ? "/" + encodeURIComponent(version) : ""}`;
}

export function isLegalVersionPath(segments: string[] | undefined): boolean {
  return (
    segments === undefined ||
    (segments.length === 1 && /^\d{4}-\d{2}-\d{2}\.\d{1,6}$/.test(segments[0]))
  );
}
