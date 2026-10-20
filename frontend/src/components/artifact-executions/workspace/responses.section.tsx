"use client";

/**
 * Respostas — o painel que dá razão de existir ao Field Registry.
 *
 * Percorre `snapshot.sections[].fields[]` e delega cada campo ao renderizador
 * do seu tipo. **Não há nada aqui sobre PMOC, Ordem de Serviço ou Relatório
 * Técnico** — nem poderia haver: o Workspace recebe a estrutura pronta e não
 * sabe que artefato está executando.
 *
 * Um tipo de campo novo entra registrando um renderizador; este arquivo não
 * muda.
 *
 * O que o painel **não** faz: decidir se a resposta é válida, se o campo é
 * obrigatório na prática, ou se a execução pode receber escrita. O primeiro e
 * o segundo pertencem ao consumidor do artefato; o terceiro é a política do
 * backend, que o Workspace aprende pela recusa (`use-execution-editability`).
 */
import { useMemo, useState } from "react";
import { ChevronDown, EyeOff, Lock } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ArtifactExecution,
  ArtifactExecutionResponse,
  SaveArtifactResponseInput,
} from "@/types/artifact-executions";
import type {
  ArtifactField,
  ArtifactSection,
} from "@/types/artifact-templates";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { resolveFieldRenderer } from "../fields/registry";

export interface ResponsesSectionProps {
  execution: ArtifactExecution;
  writable: boolean;
  saving: boolean;
  savingKey: string | null;
  error: unknown;
  onSave: (input: SaveArtifactResponseInput) => void;
}

const byOrder = <T extends { order: number }>(a: T, b: T): number =>
  a.order - b.order;

export function ResponsesSection({
  execution,
  writable,
  saving,
  savingKey,
  error,
  onSave,
}: ResponsesSectionProps) {
  const sections = useMemo(
    () => [...execution.snapshot.sections].sort(byOrder),
    [execution.snapshot.sections],
  );

  /** Índice por `sectionId:fieldId` — é a chave da resposta no contrato. */
  const responses = useMemo(() => {
    const map = new Map<string, ArtifactExecutionResponse>();
    for (const response of execution.responses) {
      map.set(`${response.sectionId}:${response.fieldId}`, response);
    }
    return map;
  }, [execution.responses]);

  const attachmentsByResponse = useMemo(() => {
    const map = new Map<string, ArtifactExecution["attachments"]>();
    for (const attachment of execution.attachments) {
      if (!attachment.responseId) continue;
      const current = map.get(attachment.responseId) ?? [];
      map.set(attachment.responseId, [...current, attachment]);
    }
    return map;
  }, [execution.attachments]);

  return (
    <PanelFrame
      panelId="artifact-execution-responses"
      title="Respostas"
      description={`${execution.snapshot.templateName} · versão ${execution.snapshot.templateVersion}`}
      actions={
        writable ? null : (
          <Badge variant="secondary" className="gap-1">
            <Lock className="size-3" aria-hidden />
            Somente leitura
          </Badge>
        )
      }
    >
      <div className="space-y-4">
        <MutationError error={error} />

        {sections.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Esta execução não tem seções.
          </p>
        ) : (
          sections.map((section) => (
            <SectionBlock
              key={section.id}
              section={section}
              responses={responses}
              attachmentsByResponse={attachmentsByResponse}
              writable={writable}
              saving={saving}
              savingKey={savingKey}
              onSave={onSave}
            />
          ))
        )}
      </div>
    </PanelFrame>
  );
}

function SectionBlock({
  section,
  responses,
  attachmentsByResponse,
  writable,
  saving,
  savingKey,
  onSave,
}: {
  section: ArtifactSection;
  responses: ReadonlyMap<string, ArtifactExecutionResponse>;
  attachmentsByResponse: ReadonlyMap<string, ArtifactExecution["attachments"]>;
  writable: boolean;
  saving: boolean;
  savingKey: string | null;
  onSave: (input: SaveArtifactResponseInput) => void;
}) {
  const [open, setOpen] = useState(true);
  const fields = useMemo(
    () => [...section.fields].sort(byOrder),
    [section.fields],
  );
  const answered = fields.filter((field) =>
    responses.has(`${section.id}:${field.id}`),
  ).length;

  return (
    <section className="rounded-xl border border-border">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{section.title}</h3>
            {section.required ? (
              <span className="text-xs text-destructive">obrigatória</span>
            ) : null}
            {section.visibility !== "VISIBLE" ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <EyeOff className="size-3" aria-hidden />
                {section.visibility}
              </span>
            ) : null}
          </div>
          {section.description ? (
            <p className="text-xs text-muted-foreground">
              {section.description}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {answered}/{fields.length}
          </span>
          {section.collapsible ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-expanded={open}
              aria-label={open ? "Recolher seção" : "Expandir seção"}
              onClick={() => setOpen((current) => !current)}
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  !open && "-rotate-90",
                )}
              />
            </Button>
          ) : null}
        </div>
      </header>

      {open ? (
        <div className="divide-y divide-border">
          {fields.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              Seção sem campos.
            </p>
          ) : (
            fields.map((field) => {
              const key = `${section.id}:${field.id}`;
              const response = responses.get(key);
              return (
                <FieldRow
                  key={field.id}
                  sectionId={section.id}
                  field={field}
                  response={response}
                  attachments={
                    response
                      ? attachmentsByResponse.get(response.id)
                      : undefined
                  }
                  writable={writable}
                  saving={saving && savingKey === key}
                  onSave={(value) =>
                    onSave({
                      sectionId: section.id,
                      fieldId: field.id,
                      value,
                      unit: field.unit,
                    })
                  }
                />
              );
            })
          )}
        </div>
      ) : null}
    </section>
  );
}

function FieldRow({
  sectionId,
  field,
  response,
  attachments,
  writable,
  saving,
  onSave,
}: {
  sectionId: string;
  field: ArtifactField;
  response?: ArtifactExecutionResponse;
  attachments?: ArtifactExecution["attachments"];
  writable: boolean;
  saving: boolean;
  onSave: (value: unknown) => void;
}) {
  const renderer = resolveFieldRenderer(field.type);
  const readOnlyField = field.readOnly || !writable || !renderer.Editor;
  const Editor = renderer.Editor;

  return (
    <div
      className={cn(
        "grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]",
        field.hidden && "opacity-60",
      )}
      data-field={`${sectionId}:${field.id}`}
    >
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{field.label}</span>
          {field.required ? (
            <span className="text-destructive" aria-label="obrigatório">
              *
            </span>
          ) : null}
          <Badge variant="secondary" className="text-[10px]">
            {field.type}
          </Badge>
          {field.hidden ? (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <EyeOff className="size-3" aria-hidden />
              oculto
            </span>
          ) : null}
        </div>
        {field.description ? (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        ) : null}
        {response ? <ResponseMeta response={response} /> : null}
      </div>

      <div className="min-w-0">
        {readOnlyField || !Editor ? (
          <renderer.View
            field={field}
            response={response}
            attachments={attachments}
          />
        ) : (
          <Editor
            field={field}
            response={response}
            attachments={attachments}
            disabled={!writable}
            saving={saving}
            onSave={onSave}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Procedência da resposta.
 *
 * `provenance` distingue o que foi digitado do que veio de sensor, importação,
 * sistema ou IA. É informação de auditoria que o backend guarda por resposta —
 * apresentá-la evita que um valor calculado pareça uma medição feita em campo.
 */
function ResponseMeta({ response }: { response: ArtifactExecutionResponse }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
      <span className="rounded bg-surface-strong px-1.5 py-0.5 uppercase">
        {response.provenance}
      </span>
      {response.notes ? <span>· {response.notes}</span> : null}
    </p>
  );
}
