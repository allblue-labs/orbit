/**
 * Saída da fronteira do contrato: árvore do editor → corpo aceito pela API.
 *
 * Três responsabilidades, e nenhuma além delas:
 *
 * 1. **Derivar `order`** da posição na árvore. O editor nunca edita esse
 *    campo; ele é consequência de onde o nó está.
 * 2. **Recusar o que o contrato não expressa** — hoje, nós de grupo. Achatar
 *    em silêncio perderia a intenção de quem editou sem dizer nada.
 * 3. **Antecipar as restrições que o backend declara**, para que o usuário
 *    veja o problema antes de perder o envio.
 *
 * Sobre o item 3: nada aqui é regra inventada. Cada verificação corresponde a
 * uma restrição declarada em `ArtifactTemplateDto`/`ArtifactTemplateValidator`
 * — formato de identificador, unicidade, quantidade mínima de seções. O
 * servidor continua sendo quem decide: quando ele recusa, a mensagem dele é
 * apresentada como veio, e nenhuma verificação daqui bloqueia algo que ele
 * aceitaria.
 */
import {
  ARTIFACT_LIMITS,
  type ArtifactFieldInput,
  type ArtifactSectionInput,
  type ArtifactSignatureSlotInput,
  type ArtifactStructureInput,
} from "@/types/artifact-templates";
import {
  nodeLabel,
  walk,
  type StudioDocument,
  type StudioFieldNode,
  type StudioNode,
  type StudioSectionNode,
  type StudioSignatureNode,
} from "./tree";

export interface StructureProblem {
  /** `nodeId` do nó culpado, quando há um. */
  readonly nodeId?: string;
  readonly message: string;
}

export type SerializeResult =
  | { readonly ok: true; readonly structure: ArtifactStructureInput }
  | { readonly ok: false; readonly problems: readonly StructureProblem[] };

export function serializeDocument(document: StudioDocument): SerializeResult {
  const problems = inspectDocument(document);
  if (problems.length > 0) return { ok: false, problems };

  const sections = document.structure.children
    .filter((node): node is StudioSectionNode => node.kind === "section")
    .map((section, index) => toSection(section, index));

  const signatureSlots = document.signatures.children
    .filter((node): node is StudioSignatureNode => node.kind === "signature")
    .map((slot, index) => toSignature(slot, index));

  return {
    ok: true,
    structure: {
      metadata: document.metadata,
      sections,
      signatureSlots,
      layout: document.layout,
    },
  };
}

/**
 * Problemas encontrados na árvore, sem serializar.
 *
 * A interface chama isto a cada alteração para mostrar o estado da estrutura;
 * `serializeDocument` chama antes de montar o corpo.
 */
export function inspectDocument(
  document: StudioDocument,
): readonly StructureProblem[] {
  const problems: StructureProblem[] = [];
  const sections = document.structure.children.filter(
    (node): node is StudioSectionNode => node.kind === "section",
  );

  if (sections.length < ARTIFACT_LIMITS.minSections) {
    problems.push({
      message: "A estrutura precisa de pelo menos uma seção.",
    });
  }
  if (sections.length > ARTIFACT_LIMITS.maxSections) {
    problems.push({
      message: `O limite é de ${ARTIFACT_LIMITS.maxSections} seções.`,
    });
  }

  /** Grupos existem no modelo, não no contrato — ver `tree.ts`. */
  for (const node of walk(document.structure)) {
    if (node.kind === "group") {
      problems.push({
        nodeId: node.nodeId,
        message:
          "Agrupamentos ainda não são salvos. Remova o grupo ou mova os campos para a seção.",
      });
    }
  }

  problems.push(...duplicates(sections, "seção"));
  for (const section of sections) {
    const fields = section.children.filter(
      (node): node is StudioFieldNode => node.kind === "field",
    );
    if (fields.length > ARTIFACT_LIMITS.maxFieldsPerSection) {
      problems.push({
        nodeId: section.nodeId,
        message: `Uma seção aceita no máximo ${ARTIFACT_LIMITS.maxFieldsPerSection} campos.`,
      });
    }
    problems.push(...duplicates(fields, `campo da seção "${section.title}"`));
  }

  const signatures = document.signatures.children.filter(
    (node): node is StudioSignatureNode => node.kind === "signature",
  );
  if (signatures.length > ARTIFACT_LIMITS.maxSignatureSlots) {
    problems.push({
      message: `O limite é de ${ARTIFACT_LIMITS.maxSignatureSlots} assinaturas.`,
    });
  }
  problems.push(...duplicates(signatures, "assinatura"));

  for (const node of walk(document.structure)) {
    problems.push(...inspectIdentity(node));
  }
  for (const node of walk(document.signatures)) {
    problems.push(...inspectIdentity(node));
  }

  return problems;
}

/** Formato de `id`, `type` e rótulo — os padrões vêm do `class-validator`. */
function inspectIdentity(node: StudioNode): readonly StructureProblem[] {
  if (node.kind === "root") return [];
  const problems: StructureProblem[] = [];
  const label = nodeLabel(node).trim();

  if (!ARTIFACT_LIMITS.identifierPattern.test(node.id)) {
    problems.push({
      nodeId: node.nodeId,
      message: `O identificador "${node.id}" precisa começar com letra e usar apenas letras, números, ponto, hífen ou sublinhado.`,
    });
  }
  if (node.id.length > ARTIFACT_LIMITS.identifierMaxLength) {
    problems.push({
      nodeId: node.nodeId,
      message: `O identificador "${node.id}" passa de ${ARTIFACT_LIMITS.identifierMaxLength} caracteres.`,
    });
  }
  if (label.length === 0) {
    problems.push({ nodeId: node.nodeId, message: "O rótulo é obrigatório." });
  }
  if (label.length > ARTIFACT_LIMITS.labelMaxLength) {
    problems.push({
      nodeId: node.nodeId,
      message: `O rótulo passa de ${ARTIFACT_LIMITS.labelMaxLength} caracteres.`,
    });
  }

  const type =
    node.kind === "field" || node.kind === "section"
      ? node.type
      : node.kind === "signature"
        ? node.signerRole
        : null;
  if (type !== null && !ARTIFACT_LIMITS.typePattern.test(type)) {
    problems.push({
      nodeId: node.nodeId,
      message: `"${type}" precisa começar com letra maiúscula e usar apenas maiúsculas, números, ponto, hífen ou sublinhado.`,
    });
  }

  return problems;
}

function duplicates(
  nodes: readonly { nodeId: string; id: string }[],
  label: string,
): readonly StructureProblem[] {
  const seen = new Map<string, string>();
  const problems: StructureProblem[] = [];
  for (const node of nodes) {
    const first = seen.get(node.id);
    if (first) {
      problems.push({
        nodeId: node.nodeId,
        message: `Já existe outra ${label} com o identificador "${node.id}".`,
      });
      continue;
    }
    seen.set(node.id, node.nodeId);
  }
  return problems;
}

function toSection(
  node: StudioSectionNode,
  order: number,
): ArtifactSectionInput {
  return {
    id: node.id,
    title: node.title.trim(),
    description: emptyToUndefined(node.description),
    order,
    type: node.type,
    required: node.required,
    visibility: node.visibility,
    permissions: [...node.permissions],
    collapsible: node.collapsible,
    configuration: node.configuration,
    fields: node.children
      .filter((child): child is StudioFieldNode => child.kind === "field")
      .map((field, index) => toField(field, index)),
  };
}

function toField(node: StudioFieldNode, order: number): ArtifactFieldInput {
  return {
    id: node.id,
    label: node.label.trim(),
    description: emptyToUndefined(node.description),
    type: node.type,
    order,
    required: node.required,
    readOnly: node.readOnly,
    hidden: node.hidden,
    defaultValue: node.defaultValue,
    validations: [...node.validations],
    dependencies: [...node.dependencies],
    conditionalExpression: node.conditionalExpression,
    placeholder: emptyToUndefined(node.placeholder),
    mask: emptyToUndefined(node.mask),
    unit: emptyToUndefined(node.unit),
    configuration: node.configuration,
  };
}

function toSignature(
  node: StudioSignatureNode,
  order: number,
): ArtifactSignatureSlotInput {
  return {
    id: node.id,
    label: node.label.trim(),
    signerRole: node.signerRole,
    order,
    required: node.required,
    visibility: node.visibility,
    permissions: [...node.permissions],
    configuration: node.configuration,
  };
}

/**
 * String vazia é omissão, não valor.
 *
 * O `ValidationPipe` usa `forbidNonWhitelisted`, e campos opcionais com
 * `MaxLength`/`MinLength` recusam `""` — enviar o campo em branco viraria 400.
 */
function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
