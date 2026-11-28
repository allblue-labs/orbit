import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, ArrowLeft, ShieldCheck } from "lucide-react";
import { backendJson } from "@/server/backend-client";
import type { LegalDocumentReadModel } from "@/types/contracts/modules/legal/legal.read-models";
import { formatDate } from "@/lib/formatters";
import { ApiError } from "@/lib/api-error";
import {
  isLegalVersionPath,
  legalDocumentDownloadHref,
} from "@/lib/legal-document-paths";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export default async function LegalPage({
  params,
}: {
  params: Promise<{ slug: string; version?: string[] }>;
}) {
  const { slug, version: segments } = await params;
  if (
    (slug !== "termos" && slug !== "privacidade") ||
    !isLegalVersionPath(segments)
  ) {
    notFound();
  }
  const version = segments?.[0];
  const document = await backendJson<LegalDocumentReadModel>({
    path: `/legal/documents/${slug}`,
    query: { version },
  }).catch((error: unknown) => {
    if (version && error instanceof ApiError && error.status === 409)
      return null;
    throw error;
  });
  // An older API can ignore the version parameter during a rolling deployment.
  if (!document || (version && document.version !== version)) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <p role="alert">
          Esta versão do documento está indisponível. Se estiver no cadastro,
          atualize a página antes de ler e aceitar os documentos.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-10 sm:px-10">
      <div className="flex flex-wrap items-center justify-between gap-4 print:hidden">
        <Link
          href="/cadastro"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <ArrowLeft className="size-4" />
          Orbit
        </Link>
        <Button asChild variant="outline" size="sm">
          <a href={legalDocumentDownloadHref(slug, document.version)} download>
            <Download />
            Baixar PDF
          </a>
        </Button>
      </div>
      <header className="space-y-4 border-b pb-7">
        <ShieldCheck className="size-9 text-primary" aria-hidden />
        <h1 className="font-display text-3xl font-semibold">
          {document.title}
        </h1>
        <p className="text-sm text-muted-foreground">
          Versão {document.version} · Vigência:{" "}
          {formatDate(document.effectiveAt)}
        </p>
        <address className="text-sm not-italic leading-relaxed">
          {document.provider.name}
          <br />
          CNPJ {document.provider.document}
          <br />
          {document.provider.location}
          {document.provider.privacyEmail ? (
            <>
              <br />
              <a
                className="underline"
                href={`mailto:${document.provider.privacyEmail}`}
              >
                {document.provider.privacyEmail}
              </a>
            </>
          ) : null}
        </address>
      </header>
      <nav
        aria-label="Conteúdo do documento"
        className="rounded-xl border bg-muted/30 p-5 print:hidden"
      >
        <ol className="space-y-2 text-sm">
          {document.sections.map((s, index) => (
            <li key={s.title}>
              <a
                href={`#secao-${index + 1}`}
                className="text-muted-foreground hover:text-foreground"
              >
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <article className="space-y-8">
        {document.sections.map((section, index) => (
          <section
            key={section.title}
            id={`secao-${index + 1}`}
            className="scroll-mt-8 space-y-3"
          >
            <h2 className="text-lg font-semibold">{section.title}</h2>
            {section.paragraphs.map((p) => (
              <p
                key={p}
                className="text-sm leading-7 text-muted-foreground print:text-black"
              >
                {p}
              </p>
            ))}
          </section>
        ))}
      </article>
    </main>
  );
}
