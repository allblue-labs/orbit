"use client";

/**
 * Inspetor do nó selecionado.
 *
 * Um componente por tipo de nó, escolhido por `kind`. Acrescentar um tipo novo
 * é acrescentar um caso — nada aqui é `if (isField) ... else ...` espalhado
 * pelo formulário.
 *
 * Todos os campos correspondem a propriedades do contrato. Onde o contrato diz
 * "JSON livre", o inspetor mostra JSON livre (ver `json-field.tsx`).
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  toIdentifier,
  toTypeIdentifier,
  type StudioFieldNode,
  type StudioNode,
  type StudioSectionNode,
  type StudioSignatureNode,
} from "@/lib/artifact-studio";
import { REGISTERED_FIELD_TYPES } from "@/components/artifact-executions/fields/registry";
import { ARTIFACT_LIMITS } from "@/types/artifact-templates";
import { JsonField } from "./json-field";

export interface NodeInspectorProps {
  node: StudioNode | null;
  readOnly: boolean;
  onPatch: (change: Record<string, unknown>) => void;
}

export function NodeInspector({ node, readOnly, onPatch }: NodeInspectorProps) {
  if (!node || node.kind === "root") {
    return (
      <p className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
        Selecione um item da estrutura para editar suas propriedades.
      </p>
    );
  }

  switch (node.kind) {
    case "section":
    case "group":
      return (
        <SectionInspector
          node={node as StudioSectionNode}
          readOnly={readOnly}
          onPatch={onPatch}
        />
      );
    case "signature":
      return (
        <SignatureInspector node={node} readOnly={readOnly} onPatch={onPatch} />
      );
    default:
      return (
        <FieldInspector node={node} readOnly={readOnly} onPatch={onPatch} />
      );
  }
}

function IdentifierInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Identificador</Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        maxLength={ARTIFACT_LIMITS.identifierMaxLength}
        onChange={(event) => onChange(toIdentifier(event.target.value))}
        className="font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">
        Único dentro do seu nível. É a chave que identifica o dado preenchido —
        mudá-la desliga o histórico já respondido com o identificador antigo.
      </p>
    </div>
  );
}

function TypeInput({
  id,
  label,
  value,
  disabled,
  suggestions,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  suggestions?: readonly string[];
  onChange: (value: string) => void;
}) {
  const listId = suggestions ? `${id}-suggestions` : undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        disabled={disabled}
        list={listId}
        maxLength={ARTIFACT_LIMITS.typeMaxLength}
        onChange={(event) => onChange(toTypeIdentifier(event.target.value))}
        className="font-mono text-sm"
      />
      {suggestions ? (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      ) : null}
      <p className="text-xs text-muted-foreground">
        Campo livre: apenas o formato é conferido. O significado é dado por quem consome o documento.
      </p>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        {description ? (
          <p className="text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}

function PermissionsInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: readonly string[];
  disabled: boolean;
  onChange: (value: readonly string[]) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Permissões</Label>
      <Input
        id={id}
        value={value.join(", ")}
        disabled={disabled}
        placeholder="operations.manage, artifact_templates.read"
        onChange={(event) =>
          onChange(
            event.target.value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
      <p className="text-xs text-muted-foreground">
        Chaves de permissão que o consumidor do artefato deve exigir. O Studio
        as guarda; quem as aplica é quem executa o artefato.
      </p>
    </div>
  );
}

function SectionInspector({
  node,
  readOnly,
  onPatch,
}: {
  node: StudioSectionNode;
  readOnly: boolean;
  onPatch: (change: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="section-title">Título</Label>
        <Input
          id="section-title"
          value={node.title}
          disabled={readOnly}
          maxLength={ARTIFACT_LIMITS.labelMaxLength}
          onChange={(event) => onPatch({ title: event.target.value })}
        />
      </div>

      <IdentifierInput
        id="section-id"
        value={node.id}
        disabled={readOnly}
        onChange={(id) => onPatch({ id })}
      />

      <div className="space-y-2">
        <Label htmlFor="section-description">Descrição</Label>
        <Textarea
          id="section-description"
          value={node.description ?? ""}
          disabled={readOnly}
          rows={3}
          maxLength={ARTIFACT_LIMITS.sectionDescriptionMaxLength}
          onChange={(event) => onPatch({ description: event.target.value })}
        />
      </div>

      <TypeInput
        id="section-type"
        label="Tipo de seção"
        value={node.type}
        disabled={readOnly}
        onChange={(type) => onPatch({ type })}
      />

      <TypeInput
        id="section-visibility"
        label="Visibilidade"
        value={node.visibility}
        disabled={readOnly}
        suggestions={["VISIBLE", "HIDDEN", "CONDITIONAL"]}
        onChange={(visibility) => onPatch({ visibility })}
      />

      <ToggleRow
        id="section-required"
        label="Obrigatória"
        checked={node.required}
        disabled={readOnly}
        onChange={(required) => onPatch({ required })}
      />
      <ToggleRow
        id="section-collapsible"
        label="Recolhível"
        checked={node.collapsible}
        disabled={readOnly}
        onChange={(collapsible) => onPatch({ collapsible })}
      />

      <PermissionsInput
        id="section-permissions"
        value={node.permissions}
        disabled={readOnly}
        onChange={(permissions) => onPatch({ permissions })}
      />

      <JsonField
        id="section-configuration"
        label="Configuração"
        value={node.configuration}
        disabled={readOnly}
        onChange={(configuration) =>
          onPatch({ configuration: configuration ?? {} })
        }
      />
    </div>
  );
}

function FieldInspector({
  node,
  readOnly,
  onPatch,
}: {
  node: StudioFieldNode;
  readOnly: boolean;
  onPatch: (change: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="field-label">Rótulo</Label>
        <Input
          id="field-label"
          value={node.label}
          disabled={readOnly}
          maxLength={ARTIFACT_LIMITS.labelMaxLength}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </div>

      <IdentifierInput
        id="field-id"
        value={node.id}
        disabled={readOnly}
        onChange={(id) => onPatch({ id })}
      />

      <TypeInput
        id="field-type"
        label="Tipo de campo"
        value={node.type}
        disabled={readOnly}
        suggestions={REGISTERED_FIELD_TYPES}
        onChange={(type) => onPatch({ type })}
      />

      {/*
       * Aviso de tipo sem renderizador.
       *
       * As sugestões vêm do **Field Registry** — os tipos que a execução sabe
       * desenhar. Um tipo fora dele é aceito pelo backend e cai no
       * renderizador genérico em campo. Dizer isso agora evita a descoberta
       * durante a execução.
       */}
      {node.type && !REGISTERED_FIELD_TYPES.includes(node.type) ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Nenhum formato disponível para <code>{node.type}</code>. O campo
          será exibido pelo tratamento genérico na execução.
        </p>
      ) : null}

      <div className="space-y-2">
        <Label htmlFor="field-description">Descrição</Label>
        <Textarea
          id="field-description"
          value={node.description ?? ""}
          disabled={readOnly}
          rows={2}
          maxLength={ARTIFACT_LIMITS.fieldDescriptionMaxLength}
          onChange={(event) => onPatch({ description: event.target.value })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="field-placeholder">Texto de apoio</Label>
          <Input
            id="field-placeholder"
            value={node.placeholder ?? ""}
            disabled={readOnly}
            maxLength={ARTIFACT_LIMITS.placeholderMaxLength}
            onChange={(event) => onPatch({ placeholder: event.target.value })}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="field-unit">Unidade</Label>
          <Input
            id="field-unit"
            value={node.unit ?? ""}
            disabled={readOnly}
            maxLength={ARTIFACT_LIMITS.unitMaxLength}
            onChange={(event) => onPatch({ unit: event.target.value })}
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="field-mask">Máscara</Label>
          <Input
            id="field-mask"
            value={node.mask ?? ""}
            disabled={readOnly}
            maxLength={ARTIFACT_LIMITS.maskMaxLength}
            onChange={(event) => onPatch({ mask: event.target.value })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <ToggleRow
          id="field-required"
          label="Obrigatório"
          checked={node.required}
          disabled={readOnly}
          onChange={(required) => onPatch({ required })}
        />
        <ToggleRow
          id="field-readonly"
          label="Somente leitura"
          checked={node.readOnly}
          disabled={readOnly}
          onChange={(value) => onPatch({ readOnly: value })}
        />
        <ToggleRow
          id="field-hidden"
          label="Oculto"
          description="Permanece na estrutura, sem ser apresentado no preenchimento."
          checked={node.hidden}
          disabled={readOnly}
          onChange={(hidden) => onPatch({ hidden })}
        />
      </div>

      <JsonField
        id="field-default"
        label="Valor padrão"
        value={node.defaultValue}
        disabled={readOnly}
        rows={2}
        onChange={(defaultValue) => onPatch({ defaultValue })}
      />
      <JsonField
        id="field-validations"
        label="Validações"
        description="Lista de objetos. Aplicadas por quem executa o artefato, não pelo Studio."
        value={node.validations}
        disabled={readOnly}
        onChange={(validations) =>
          onPatch({
            validations: Array.isArray(validations) ? validations : [],
          })
        }
      />
      <JsonField
        id="field-dependencies"
        label="Dependências"
        description="Lista de objetos que descrevem a relação com outros campos."
        value={node.dependencies}
        disabled={readOnly}
        onChange={(dependencies) =>
          onPatch({
            dependencies: Array.isArray(dependencies) ? dependencies : [],
          })
        }
      />
      <JsonField
        id="field-conditional"
        label="Expressão condicional"
        value={node.conditionalExpression}
        disabled={readOnly}
        rows={2}
        onChange={(conditionalExpression) => onPatch({ conditionalExpression })}
      />
      <JsonField
        id="field-configuration"
        label="Configuração"
        value={node.configuration}
        disabled={readOnly}
        onChange={(configuration) =>
          onPatch({ configuration: configuration ?? {} })
        }
      />
    </div>
  );
}

function SignatureInspector({
  node,
  readOnly,
  onPatch,
}: {
  node: StudioSignatureNode;
  readOnly: boolean;
  onPatch: (change: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signature-label">Rótulo</Label>
        <Input
          id="signature-label"
          value={node.label}
          disabled={readOnly}
          maxLength={ARTIFACT_LIMITS.labelMaxLength}
          onChange={(event) => onPatch({ label: event.target.value })}
        />
      </div>

      <IdentifierInput
        id="signature-id"
        value={node.id}
        disabled={readOnly}
        onChange={(id) => onPatch({ id })}
      />

      <TypeInput
        id="signature-role"
        label="Papel do signatário"
        value={node.signerRole}
        disabled={readOnly}
        suggestions={["OPERATOR", "CUSTOMER", "SUPERVISOR", "TECHNICIAN"]}
        onChange={(signerRole) => onPatch({ signerRole })}
      />

      <TypeInput
        id="signature-visibility"
        label="Visibilidade"
        value={node.visibility}
        disabled={readOnly}
        suggestions={["VISIBLE", "HIDDEN", "CONDITIONAL"]}
        onChange={(visibility) => onPatch({ visibility })}
      />

      <ToggleRow
        id="signature-required"
        label="Obrigatória"
        checked={node.required}
        disabled={readOnly}
        onChange={(required) => onPatch({ required })}
      />

      <PermissionsInput
        id="signature-permissions"
        value={node.permissions}
        disabled={readOnly}
        onChange={(permissions) => onPatch({ permissions })}
      />

      <JsonField
        id="signature-configuration"
        label="Configuração"
        value={node.configuration}
        disabled={readOnly}
        onChange={(configuration) =>
          onPatch({ configuration: configuration ?? {} })
        }
      />
    </div>
  );
}
