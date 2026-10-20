"use client";

/**
 * Criação de template.
 *
 * `POST /artifact-templates` exige a estrutura junto com os metadados —
 * `ArtifactStructureDto` pede `@ArrayMinSize(1)` em `sections`. Não existe
 * "template vazio" no contrato, então a criação já nasce com uma seção, e o
 * detalhamento acontece no Studio.
 *
 * A chave é sugerida a partir do nome e permanece editável: ela é única por
 * organização e aparece em integrações, o que a torna decisão de quem
 * configura, não do editor.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateArtifactTemplate } from "@/hooks/artifact-templates/use-artifact-templates";
import {
  emptyDocument,
  serializeDocument,
  toTemplateKey,
  toTypeIdentifier,
} from "@/lib/artifact-studio";
import { ROUTES } from "@/lib/routes";
import { ARTIFACT_LIMITS } from "@/types/artifact-templates";
import { allTemplateTypes, TemplateTypeCard } from "@/artifacts";
import { MutationError } from "./mutation-error";

export function CreateTemplateDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  /** `null` significa "ainda acompanha o nome". */
  const [keyDraft, setKeyDraft] = useState<string | null>(null);
  const [artifactType, setArtifactType] = useState("");
  const [description, setDescription] = useState("");

  const create = useCreateArtifactTemplate();

  /**
   * A chave acompanha o nome até alguém editá-la — derivada, não sincronizada
   * por efeito: o valor exibido é sempre função do que já está no estado.
   */
  const key = keyDraft ?? toTemplateKey(name);

  const reset = () => {
    setName("");
    setKeyDraft(null);
    setArtifactType("");
    setDescription("");
    create.reset();
  };

  const submit = () => {
    const serialized = serializeDocument(emptyDocument());
    /** O documento inicial é fixo e válido; a guarda existe pelo tipo. */
    if (!serialized.ok) return;

    create.mutate(
      {
        ...serialized.structure,
        key,
        name: name.trim(),
        artifactType,
        description: description.trim() || undefined,
      },
      {
        onSuccess: (template) => {
          setOpen(false);
          reset();
          router.push(`${ROUTES.artifacts}/${template.id}`);
        },
      },
    );
  };

  const canSubmit =
    name.trim().length >= 2 &&
    ARTIFACT_LIMITS.keyPattern.test(key) &&
    ARTIFACT_LIMITS.typePattern.test(artifactType) &&
    !create.isPending;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          Novo template
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Artifact Template</DialogTitle>
          <DialogDescription>
            O template nasce como rascunho, na versão 1, com uma seção inicial.
            A estrutura é detalhada no Studio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="template-name">Nome</Label>
            <Input
              id="template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={ARTIFACT_LIMITS.nameMaxLength}
              placeholder="Relatório de manutenção preventiva"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-key">Chave</Label>
            <Input
              id="template-key"
              value={key}
              onChange={(event) =>
                setKeyDraft(toTemplateKey(event.target.value))
              }
              maxLength={ARTIFACT_LIMITS.keyMaxLength}
              placeholder="RELATORIO_MANUTENCAO"
            />
            <p className="text-xs text-muted-foreground">
              Única na organização. Maiúsculas, números, hífen e sublinhado.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Tipo de artefato</Label>
            <div className="grid max-h-56 gap-1.5 overflow-y-auto pr-1">
              {allTemplateTypes().map((type) => (
                <TemplateTypeCard
                  key={type.id}
                  type={type}
                  selected={artifactType === type.id}
                  onSelect={() => setArtifactType(type.id)}
                />
              ))}
            </div>

            <details className="rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Outro tipo
              </summary>
              <div className="mt-2 space-y-2">
                <Input
                  id="template-type"
                  value={artifactType}
                  onChange={(event) =>
                    setArtifactType(toTypeIdentifier(event.target.value))
                  }
                  maxLength={ARTIFACT_LIMITS.typeMaxLength}
                  placeholder="RELATORIO"
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Qualquer classificação em formato válido é aceita. Um tipo fora do catálogo aparece com o identificador legível
                  até ser registrado.
                </p>
              </div>
            </details>
          </div>

          <div className="space-y-2">
            <Label htmlFor="template-description">Descrição</Label>
            <Textarea
              id="template-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={ARTIFACT_LIMITS.descriptionMaxLength}
              rows={3}
            />
          </div>

          <MutationError error={create.error} />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {create.isPending ? "Criando…" : "Criar template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
