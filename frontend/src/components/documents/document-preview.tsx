"use client";

/**
 * Conteúdo de uma revisão.
 *
 * ## Nunca acessa o storage
 *
 * A URL é pedida ao backend (`GET /artifact-manifests/:id/download`) e usada
 * como veio — **absoluta e assinada**. O cliente não a reescreve, não a
 * proxia e não conhece bucket nem chave: nada disso existe em contrato.
 *
 * A URL tem prazo curto. Ela é pedida quando o usuário abre a revisão, e o
 * painel mostra até quando vale — em vez de o usuário descobrir por uma falha
 * silenciosa.
 *
 * ## Preview antes de download
 *
 * Formato com visualizador é **aberto** num quadro isolado. Baixar continua
 * disponível, como ação explícita.
 */
import { useState } from "react";
import { Download, ExternalLink, Eye, Share2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAction } from "@/actions";
import {
  ContentHash,
  DocumentFormatBadge,
  RendererLabel,
  resolveFormat,
} from "@/documents";
import { useSignedUrl } from "@/hooks/documents/use-signed-url";
import { formatDateTime } from "@/lib/formatters";
import type {
  ArtifactManifestSummary,
  SignedUrlOperation,
} from "@/types/documents";

export function DocumentPreview({
  manifestId,
  summary,
}: {
  manifestId: string;
  summary: ArtifactManifestSummary;
}) {
  const format = resolveFormat(summary.format);
  const [operation, setOperation] = useState<SignedUrlOperation>(
    format.previewable ? "preview" : "download",
  );

  /**
   * A URL se renova antes de vencer.
   *
   * O prazo vem do `expiresAt` publicado pelo backend, não de um `staleTime`
   * escolhido a esmo — ver `useSignedUrl`. Um visualizador que fica aberto
   * continua funcionando.
   */
  const signed = useSignedUrl(manifestId, operation, {
    enabled: summary.status !== "REVOKED" && Boolean(summary.contentHash),
  });

  const canDownload = useAction("artifact-execution.download-document").allowed;
  const share = useAction("artifact-execution.share-document");

  if (summary.status === "REVOKED") {
    return (
      <div className="space-y-3 rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <p className="text-sm font-medium">Documento revogado</p>
        <p className="text-xs text-muted-foreground">
          {summary.revokedReason ?? "Sem motivo informado."} Um documento revogado não é mais distribuído — o registro permanece para auditoria.
        </p>
      </div>
    );
  }

  if (!summary.contentHash) {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        Esta revisão é um rascunho: nenhum conteúdo foi entregue ainda.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <Metadata summary={summary} />

      <div className="flex flex-wrap items-center gap-2">
        {format.previewable ? (
          <Button
            variant={operation === "preview" ? "default" : "outline"}
            size="sm"
            onClick={() => setOperation("preview")}
          >
            <Eye className="size-4" />
            Visualizar
          </Button>
        ) : null}

        {canDownload && signed.data ? (
          <Button variant="outline" size="sm" asChild>
            {/*
              A URL assinada é absoluta e de outra origem — `download` no
              anchor é uma dica, e o cabeçalho que o backend assina é quem
              decide entre abrir e salvar.
            */}
            <a
              href={signed.data.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOperation("download")}
            >
              <Download className="size-4" />
              Baixar
            </a>
          </Button>
        ) : null}

        {signed.data ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={signed.data.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" />
              Abrir em nova aba
            </a>
          </Button>
        ) : null}

        {/*
          Compartilhamento é placeholder arquitetural.

          Não existe contrato: a URL assinada é curta e pessoal, e não há
          endpoint que crie link público ou envie por e-mail. O botão declara a
          ausência em vez de sumir sem explicação.
        */}
        {!share.allowed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="ghost" size="sm" disabled>
                  <Share2 className="size-4" />
                  Compartilhar
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs">
              {share.blockReason}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>

      <MutationError error={signed.error} />

      {signed.isPending ? (
        <PanelLoading rows={4} />
      ) : signed.data ? (
        <div className="space-y-2">
          <Frame
            url={signed.data.url}
            viewer={format.viewer}
            title={`Documento ${summary.revision}`}
          />
          <p className="text-xs text-muted-foreground">
            Acesso temporário, renovado automaticamente enquanto esta tela
            estiver aberta — o atual vale até{" "}
            {formatDateTime(signed.data.expiresAt)}. O link é temporário e pessoal; o arquivo nunca é acessado diretamente.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Quadro de exibição.
 *
 * `sandbox` sem `allow-scripts`: o documento é conteúdo de tenant, e mesmo
 * tendo sido escapado na geração, exibi-lo sem permissão de execução é a
 * segunda barreira. Nada que venha do documento roda na origem da aplicação.
 */
function Frame({
  url,
  viewer,
  title,
}: {
  url: string;
  viewer: "embedded" | "text" | "download-only";
  title: string;
}) {
  if (viewer === "download-only") {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        Não há visualizador para este formato. Use o download.
      </p>
    );
  }

  return (
    <iframe
      src={url}
      title={title}
      sandbox=""
      referrerPolicy="no-referrer"
      className="h-[60vh] w-full rounded-lg border border-border bg-white"
    />
  );
}

function Metadata({ summary }: { summary: ArtifactManifestSummary }) {
  return (
    <dl className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
      <Field label="Revisão">
        <span className="flex items-center gap-2">
          <span className="font-medium">{summary.revision}</span>
          {summary.isActive ? <Badge variant="secondary">ativa</Badge> : null}
        </span>
      </Field>
      <Field label="Formato">
        <DocumentFormatBadge format={summary.format} />
      </Field>
      <Field label="Renderizador">
        <RendererLabel
          renderer={summary.renderer}
          version={summary.rendererVersion}
        />
      </Field>
      <Field label="Emitido em">
        <span className="text-sm">
          {summary.issuedAt ? formatDateTime(summary.issuedAt) : "—"}
        </span>
      </Field>
      <Field label="Emitido por">
        <span className="text-sm">{summary.issuedBy?.displayName ?? "—"}</span>
      </Field>
      <Field label="Código de verificação do arquivo">
        <ContentHash hash={summary.contentHash} />
      </Field>
      <Field label="Código de verificação da origem">
        <ContentHash hash={summary.sourceHash} />
      </Field>
      <Field label="Versão do template">
        <span className="text-sm">v{summary.templateVersion}</span>
      </Field>
    </dl>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
