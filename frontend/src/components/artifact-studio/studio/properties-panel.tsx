"use client";

/**
 * Propriedades do template — a única área com salvamento automático.
 *
 * **Por que só aqui.** Auto Save exige uma escrita idempotente, e o módulo tem
 * exatamente uma: `PATCH /artifact-templates/:id`, que altera metadados no
 * lugar. A estrutura não tem equivalente — a única forma de persistir seções e
 * campos é `POST /:id/versions`, que **cria uma versão nova e imutável**.
 * Salvar estrutura automaticamente produziria uma versão por pausa de
 * digitação e transformaria o histórico em ruído, apagando a diferença entre
 * "estou mexendo" e "publiquei".
 *
 * O salvamento espera a digitação parar e envia apenas os campos que de fato
 * mudaram em relação ao que o servidor devolveu.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, TriangleAlert } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useUpdateArtifactTemplate } from "@/hooks/artifact-templates/use-artifact-templates";
import { toTypeIdentifier } from "@/lib/artifact-studio";
import {
  ARTIFACT_LIMITS,
  ARTIFACT_TEMPLATE_VISIBILITIES,
  type ArtifactTemplate,
  type ArtifactTemplateVisibility,
  type UpdateArtifactTemplateInput,
} from "@/types/artifact-templates";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MutationError } from "../mutation-error";
import { templateVisibilityLabel } from "../template-badges";

const AUTOSAVE_DELAY_MS = 1200;

interface PropertiesForm {
  name: string;
  description: string;
  artifactType: string;
  segment: string;
  visibility: ArtifactTemplateVisibility;
  tags: readonly string[];
  sortOrder: number;
}

export function PropertiesPanel({
  template,
  readOnly,
}: {
  template: ArtifactTemplate;
  readOnly: boolean;
}) {
  const update = useUpdateArtifactTemplate(template.id);
  const serverForm = useMemo(() => toForm(template), [template]);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  /**
   * Formulário e a versão do servidor de onde ele partiu, no mesmo estado.
   *
   * Guardá-los juntos é o que permite decidir corretamente quando o servidor
   * responde: se o usuário continuou digitando durante o salvamento, o que
   * está na tela é mais novo que a resposta e **não** pode ser sobrescrito.
   * Um `useState` isolado, sincronizado por efeito, engoliria essas teclas.
   */
  const [state, setState] = useState(() => ({
    server: serverForm,
    form: serverForm,
  }));

  /** Ajuste durante a renderização — sem efeito, sem render em cascata. */
  if (state.server !== serverForm) {
    const pending =
      Object.keys(diffForm(state.server, state.form).changes).length > 0;
    setState({ server: serverForm, form: pending ? state.form : serverForm });
  }

  const form = state.form;

  const { changes, notices } = useMemo(
    () => diffForm(serverForm, form),
    [serverForm, form],
  );
  const hasChanges = Object.keys(changes).length > 0;

  useEffect(() => {
    if (readOnly || !hasChanges) return;
    const timer = setTimeout(() => {
      update.mutate(changes, { onSuccess: () => setSavedAt(Date.now()) });
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
    // `update` muda de identidade a cada render do hook.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [changes, hasChanges, readOnly]);

  const edit = (patch: Partial<PropertiesForm>) => {
    setState((current) => ({
      ...current,
      form: { ...current.form, ...patch },
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Alterações de propriedade são salvas sozinhas. Estrutura e assinaturas
          exigem publicar uma versão.
        </p>
        <SaveState
          readOnly={readOnly}
          pending={update.isPending}
          dirty={hasChanges}
          failed={Boolean(update.error)}
          savedAt={savedAt}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="properties-name">Nome</Label>
          <Input
            id="properties-name"
            value={form.name}
            disabled={readOnly}
            maxLength={ARTIFACT_LIMITS.nameMaxLength}
            onChange={(event) => edit({ name: event.target.value })}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="properties-description">Descrição</Label>
          <Textarea
            id="properties-description"
            value={form.description}
            disabled={readOnly}
            rows={3}
            maxLength={ARTIFACT_LIMITS.descriptionMaxLength}
            onChange={(event) => edit({ description: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="properties-type">Tipo de artefato</Label>
          <Input
            id="properties-type"
            value={form.artifactType}
            disabled={readOnly}
            maxLength={ARTIFACT_LIMITS.typeMaxLength}
            onChange={(event) =>
              edit({ artifactType: toTypeIdentifier(event.target.value) })
            }
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="properties-segment">Segmento</Label>
          <Input
            id="properties-segment"
            value={form.segment}
            disabled={readOnly}
            maxLength={ARTIFACT_LIMITS.segmentMaxLength}
            onChange={(event) =>
              edit({ segment: toTypeIdentifier(event.target.value) })
            }
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="properties-visibility">Visibilidade</Label>
          <Select
            value={form.visibility}
            disabled={readOnly}
            onValueChange={(value) =>
              edit({ visibility: value as ArtifactTemplateVisibility })
            }
          >
            <SelectTrigger id="properties-visibility">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARTIFACT_TEMPLATE_VISIBILITIES.map((option) => (
                <SelectItem key={option} value={option}>
                  {templateVisibilityLabel(option)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Templates globais da plataforma não são criados aqui.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="properties-sort">Prioridade na listagem</Label>
          <Input
            id="properties-sort"
            type="number"
            min={0}
            max={100000}
            value={form.sortOrder}
            disabled={readOnly}
            onChange={(event) =>
              edit({ sortOrder: Number(event.target.value) || 0 })
            }
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="properties-tags">Etiquetas</Label>
          <Input
            id="properties-tags"
            value={form.tags.join(", ")}
            disabled={readOnly}
            placeholder="preventiva, hvac, cliente-final"
            onChange={(event) =>
              edit({
                tags: event.target.value
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Chave</Label>
        <Input value={template.key} disabled className="font-mono text-sm" />
        <p className="text-xs text-muted-foreground">
          A chave é definida na criação e não pode ser alterada — ela identifica o template em integrações. Para outra
          chave, duplique o template.
        </p>
      </div>

      {notices.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {notices.map((notice) => (
            <li key={notice} className="flex items-start gap-1.5">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {notice}
            </li>
          ))}
        </ul>
      ) : null}

      <MutationError error={update.error} />
    </div>
  );
}

function SaveState({
  readOnly,
  pending,
  dirty,
  failed,
  savedAt,
}: {
  readOnly: boolean;
  pending: boolean;
  dirty: boolean;
  failed: boolean;
  savedAt: number | null;
}) {
  if (readOnly) {
    return (
      <span className="text-xs text-muted-foreground">Somente leitura</span>
    );
  }
  if (failed) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-destructive">
        <TriangleAlert className="size-3.5" aria-hidden />
        Não salvo
      </span>
    );
  }
  if (pending) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Salvando…
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="text-xs text-muted-foreground">
        Alterações pendentes
      </span>
    );
  }
  if (savedAt) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-emerald-400">
        <Check className="size-3.5" aria-hidden />
        Salvo
      </span>
    );
  }
  return null;
}

function toForm(template: ArtifactTemplate): PropertiesForm {
  return {
    name: template.name,
    description: template.description ?? "",
    artifactType: template.artifactType,
    segment: template.segment ?? "",
    visibility: template.visibility === "PRIVATE" ? "PRIVATE" : "ORGANIZATION",
    tags: [...template.tags],
    sortOrder: template.sortOrder,
  };
}

/**
 * Só o que mudou entra no `PATCH`, e só o que o contrato aceita.
 *
 * Enviar o objeto inteiro geraria uma entrada de auditoria com "alterações"
 * que ninguém fez — o backend registra `before`/`after` a cada atualização.
 *
 * O que não pode ser enviado vira **aviso**, nunca silêncio: um valor
 * transitoriamente inválido (nome com uma letra) ou uma operação que o
 * contrato não expressa (limpar o segmento) precisa ser dita, senão o campo
 * fica editado na tela e intocado no servidor.
 */
function diffForm(
  server: PropertiesForm,
  form: PropertiesForm,
): { changes: UpdateArtifactTemplateInput; notices: readonly string[] } {
  const changes: UpdateArtifactTemplateInput = {};
  const notices: string[] = [];

  const name = form.name.trim();
  if (name !== server.name) {
    if (name.length >= 2) changes.name = name;
    else notices.push("O nome precisa de pelo menos dois caracteres.");
  }

  if (form.description !== server.description) {
    changes.description = form.description.trim();
  }

  if (form.artifactType !== server.artifactType) {
    if (ARTIFACT_LIMITS.typePattern.test(form.artifactType)) {
      changes.artifactType = form.artifactType;
    } else {
      notices.push("O tipo de artefato precisa começar com letra maiúscula.");
    }
  }

  if (form.segment !== server.segment) {
    if (ARTIFACT_LIMITS.typePattern.test(form.segment)) {
      changes.segment = form.segment;
    } else if (form.segment === "") {
      /**
       * `UpdateArtifactTemplateDto` aceita string ou omissão — não aceita
       * `null`, e omitir significa "não mexa". Remover um segmento já gravado
       * não é expressável neste contrato.
       */
      notices.push(
        "O contrato não permite remover um segmento já definido — só trocá-lo por outro.",
      );
    } else {
      notices.push("O segmento precisa começar com letra maiúscula.");
    }
  }

  if (form.visibility !== server.visibility) {
    changes.visibility = form.visibility;
  }
  if (form.sortOrder !== server.sortOrder) changes.sortOrder = form.sortOrder;
  if (form.tags.join(" ") !== server.tags.join(" ")) {
    changes.tags = [...form.tags];
  }

  return { changes, notices };
}
