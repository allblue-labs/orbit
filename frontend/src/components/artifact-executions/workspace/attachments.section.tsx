"use client";

/**
 * Anexos.
 *
 * **O contrato registra metadados, não recebe arquivo.**
 * `RegisterArtifactAttachmentDto` pede `fileName`, `mimeType`, `sizeBytes` e
 * `storageKey` — a chave de um objeto que já está no armazenamento. O backend
 * não expõe, para execuções, nenhuma rota que receba o binário (diferente de
 * `POST /operations/:id/attachments`, que é multipart), nem rota de download
 * ou de URL assinada.
 *
 * Por isso o painel:
 *
 * - **lista** os anexos com o que o contrato devolve, incluindo estado;
 * - **registra** um anexo existente, que é a operação que o backend oferece;
 * - **declara** que envio, download e pré-visualização dependem de rotas que
 *   ainda não existem, em vez de simular um seletor de arquivo que não teria
 *   para onde enviar.
 *
 * Quando as rotas existirem, o ponto de extensão é este componente: a lista, o
 * estado e o vínculo com resposta e seção já estão no lugar.
 */
import { useState } from "react";
import { FileText, Image as ImageIcon, Paperclip, Video } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatBytes, formatDateTime } from "@/lib/formatters";
import {
  ARTIFACT_ATTACHMENT_KINDS,
  ARTIFACT_EXECUTION_LIMITS,
  type ArtifactAttachmentKind,
  type ArtifactExecution,
  type RegisterArtifactAttachmentInput,
} from "@/types/artifact-executions";
import { UserReference } from "./overview.section";

const KIND_ICONS: Readonly<Record<string, typeof Paperclip>> = {
  IMAGE: ImageIcon,
  VIDEO: Video,
  DOCUMENT: FileText,
};

export function AttachmentsSection({
  execution,
  writable,
  pending,
  error,
  onRegister,
}: {
  execution: ArtifactExecution;
  writable: boolean;
  pending: boolean;
  error: unknown;
  onRegister: (input: RegisterArtifactAttachmentInput) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <PanelFrame
      panelId="artifact-execution-attachments"
      title="Anexos"
      description={`${execution.attachments.length} registrado(s)`}
      actions={
        writable ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOpen((current) => !current)}
          >
            {open ? "Cancelar" : "Registrar anexo"}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {open ? (
          <RegisterForm
            execution={execution}
            pending={pending}
            onSubmit={(input) => {
              onRegister(input);
              setOpen(false);
            }}
          />
        ) : null}

        <MutationError error={error} />

        {execution.attachments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum anexo registrado nesta execução.
          </p>
        ) : (
          <ul className="space-y-2">
            {execution.attachments.map((attachment) => {
              const Icon = KIND_ICONS[attachment.kind] ?? Paperclip;
              return (
                <li
                  key={attachment.id}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2"
                >
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{attachment.fileName}</p>
                    <p className="text-xs text-muted-foreground">
                      {attachment.mimeType} ·{" "}
                      {formatBytes(Number(attachment.sizeBytes))} ·{" "}
                      {formatDateTime(attachment.createdAt)} · por{" "}
                      <UserReference userId={attachment.uploadedById} />
                    </p>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {attachment.kind}
                  </Badge>
                  {attachment.sectionId ? (
                    <Badge variant="outline" className="text-[10px]">
                      {attachment.sectionId}
                    </Badge>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          Envio, download e pré-visualização de arquivos ainda não estão disponíveis nas execuções. O que
          existe hoje é o registro do anexo a partir de uma chave já armazenada.
        </p>
      </div>
    </PanelFrame>
  );
}

function RegisterForm({
  execution,
  pending,
  onSubmit,
}: {
  execution: ArtifactExecution;
  pending: boolean;
  onSubmit: (input: RegisterArtifactAttachmentInput) => void;
}) {
  const [kind, setKind] = useState<ArtifactAttachmentKind>("DOCUMENT");
  const [fileName, setFileName] = useState("");
  const [mimeType, setMimeType] = useState("");
  const [sizeBytes, setSizeBytes] = useState("");
  const [storageKey, setStorageKey] = useState("");
  const [sectionId, setSectionId] = useState<string>("");

  const size = Number(sizeBytes);
  const valid =
    fileName.trim().length > 0 &&
    mimeType.trim().length > 0 &&
    storageKey.trim().length > 0 &&
    Number.isFinite(size) &&
    size >= 0 &&
    size <= ARTIFACT_EXECUTION_LIMITS.maxSizeBytes;

  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="attachment-kind">Natureza</Label>
          <Select
            value={kind}
            onValueChange={(value) => setKind(value as ArtifactAttachmentKind)}
          >
            <SelectTrigger id="attachment-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARTIFACT_ATTACHMENT_KINDS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment-section">Seção</Label>
          <Select
            value={sectionId || "__none__"}
            onValueChange={(value) =>
              setSectionId(value === "__none__" ? "" : value)
            }
          >
            <SelectTrigger id="attachment-section">
              <SelectValue placeholder="Execução inteira" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Execução inteira</SelectItem>
              {execution.snapshot.sections.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment-name">Nome do arquivo</Label>
          <Input
            id="attachment-name"
            value={fileName}
            maxLength={ARTIFACT_EXECUTION_LIMITS.fileNameMaxLength}
            onChange={(event) => setFileName(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment-mime">Tipo MIME</Label>
          <Input
            id="attachment-mime"
            value={mimeType}
            placeholder="image/jpeg"
            maxLength={ARTIFACT_EXECUTION_LIMITS.mimeTypeMaxLength}
            onChange={(event) => setMimeType(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment-size">Tamanho em bytes</Label>
          <Input
            id="attachment-size"
            value={sizeBytes}
            inputMode="numeric"
            onChange={(event) => setSizeBytes(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="attachment-key">Chave de armazenamento</Label>
          <Input
            id="attachment-key"
            value={storageKey}
            maxLength={ARTIFACT_EXECUTION_LIMITS.storageKeyMaxLength}
            className="font-mono text-sm"
            onChange={(event) => setStorageKey(event.target.value)}
          />
        </div>
      </div>

      <Button
        size="sm"
        disabled={!valid || pending}
        onClick={() =>
          onSubmit({
            kind,
            fileName: fileName.trim(),
            mimeType: mimeType.trim(),
            sizeBytes: size,
            storageKey: storageKey.trim(),
            sectionId: sectionId || undefined,
          })
        }
      >
        {pending ? "Registrando…" : "Registrar"}
      </Button>
    </div>
  );
}
