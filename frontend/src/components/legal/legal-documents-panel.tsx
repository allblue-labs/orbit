"use client";
import { useState } from "react";
import { Download, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  LEGAL_DOCUMENT_VERSION,
  type LegalDocumentSlug,
} from "@/types/contracts/modules/legal/legal.read-models";
const documents = [
  {
    slug: "termos",
    title: "Termos de Uso",
    description: "Planos, pagamentos, cancelamento e responsabilidades.",
    icon: FileText,
  },
  {
    slug: "privacidade",
    title: "Política de Privacidade",
    description: "Tratamento de dados, conservação, exclusão e seus direitos.",
    icon: ShieldCheck,
  },
] as const;
export function LegalDocumentsPanel({
  compact = false,
}: {
  compact?: boolean;
}) {
  const [reading, setReading] = useState<LegalDocumentSlug | null>(null);
  const document = documents.find((d) => d.slug === reading);
  return (
    <div className="space-y-4">
      {!compact ? (
        <header>
          <h2 className="text-lg font-semibold">Termos e privacidade</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulte os documentos do Orbit e guarde uma cópia. Versão{" "}
            {LEGAL_DOCUMENT_VERSION}.
          </p>
        </header>
      ) : null}
      <div className={compact ? "grid gap-3" : "grid gap-4 md:grid-cols-2"}>
        {documents.map((d) => (
          <section
            key={d.slug}
            className="rounded-xl border border-border bg-background/70 p-4"
          >
            <div className="flex gap-3">
              <d.icon className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <h3 className="text-sm font-semibold">{d.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {d.description}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setReading(d.slug)}
              >
                Ler {d.title}
              </Button>
              <a
                className={buttonVariants({ variant: "ghost", size: "sm" })}
                href={`/api/legal/${d.slug}/download`}
                download
              >
                <Download />
                Baixar PDF
              </a>
            </div>
          </section>
        ))}
      </div>
      <Dialog
        open={!!reading}
        onOpenChange={(open) => !open && setReading(null)}
      >
        <DialogContent className="flex h-[88dvh] max-w-4xl flex-col gap-3 p-5">
          <DialogHeader>
            <DialogTitle>{document?.title}</DialogTitle>
            <DialogDescription>
              Leia o documento completo. Fechar a leitura preserva seu cadastro.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <a
              className={buttonVariants({ variant: "outline", size: "sm" })}
              href={`/legal/${reading}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink />
              Abrir em nova aba
            </a>
            <a
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              href={`/api/legal/${reading}/download`}
              download
            >
              <Download />
              Baixar PDF
            </a>
          </div>
          {reading ? (
            <iframe
              title={document?.title}
              src={`/legal/${reading}`}
              className="min-h-0 w-full flex-1 rounded-lg border bg-background"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
