/**
 * O que esta conta pode fazer, derivado dos registries.
 *
 * ## Por que não a lista de permissões
 *
 * A tela mostrava `operations.read`, `artifact_executions.manage` e mais trinta
 * linhas em monoespaçada. Esse é o vocabulário com que o sistema foi
 * construído, não o de quem trabalha nele: quem lê quer saber se consegue
 * lançar um atendimento, não que existe uma string chamada `operations.create`.
 *
 * A tradução já existia. O Entity Registry sabe o nome de cada coisa e quais
 * permissões o backend exige para ler, criar, editar e excluir; o Action
 * Registry sabe o nome em português de cada operação além do básico. Só faltava
 * perguntar a eles em vez de despejar as chaves.
 *
 * ## O eixo é a coisa, não a ação
 *
 * Agrupar por entidade dá catorze linhas legíveis; listar as 73 ações dá uma
 * parede. E é assim que a pergunta chega: "eu consigo mexer em orçamento?",
 * não "eu tenho `quotes.update`?".
 *
 * ## Duas razões de bloqueio, e elas levam a lugares diferentes
 *
 * Faltar por **papel** se resolve com quem administra a conta. Faltar por
 * **plano** se resolve na assinatura. Numa lista única de itens ausentes a
 * pessoa não sabe a quem pedir — por isso o que está fora sai separado pelo
 * motivo.
 *
 * ## Isto não autoriza nada
 *
 * É a mesma leitura que o registry faz para decidir se mostra um botão. Quem
 * autoriza é o backend, que recusa com 403 independentemente desta tela.
 */
import { allActions, type ActionDefinition } from "@/actions";
import { allEntities, type EntityDefinition } from "@/entities";
import {
  accessBlockReason,
  allowsAccess,
  type AccessContext,
} from "@/registry";

/** Por que uma operação não aparece como disponível. */
export type BlockedBy = "plano" | "papel";

export interface AccessArea {
  /** Id da entidade — chave de lista, não texto de tela. */
  readonly id: string;
  /** Nome no plural, como o Entity Registry publica. */
  readonly name: string;
  readonly allowed: readonly string[];
  readonly blocked: readonly {
    readonly label: string;
    readonly by: BlockedBy;
  }[];
}

/**
 * As quatro operações que toda entidade tem, na ordem em que se aprende a
 * usá-las. `permissions.read` é obrigatório no registry; as outras três são
 * opcionais, e faltam quando a entidade não oferece a operação.
 */
const VERBS = [
  { key: "read", label: "consultar", manages: false },
  { key: "create", label: "cadastrar", manages: true },
  { key: "update", label: "editar", manages: true },
  { key: "delete", label: "excluir", manages: true },
] as const;

/**
 * Categorias de ação que entram como extras.
 *
 * `create`, `edit` e `destructive` já estão ditas pelos verbos acima — repetir
 * "Novo cliente" depois de "cadastrar" só polui. `workflow` e `document` são o
 * que os verbos não alcançam: aprovar, concluir, emitir.
 */
const EXTRA_CATEGORIES: readonly string[] = ["workflow", "document"];

/**
 * Por que não a string de `accessBlockReason`.
 *
 * Aquela mensagem é escrita para um botão ("O plano atual não inclui este
 * recurso."); classificar por substring dela amarraria este módulo à redação de
 * outro arquivo. A exigência em si é estável: capability e produto vêm do
 * plano, permissão vem do papel.
 *
 * Quando as duas faltam, o motivo é o papel: subir de plano não resolveria.
 */
function blockedBy(
  requirement: {
    readonly permission?: string;
    readonly capability?: string;
    readonly productCapability?: string;
  },
  access: AccessContext,
): BlockedBy {
  if (requirement.permission && !access.hasPermission(requirement.permission)) {
    return "papel";
  }
  return requirement.capability || requirement.productCapability
    ? "plano"
    : "papel";
}

function areaFor(
  entity: EntityDefinition,
  actions: readonly ActionDefinition[],
  access: AccessContext,
): AccessArea {
  const allowed: string[] = [];
  const blocked: { label: string; by: BlockedBy }[] = [];

  for (const verb of VERBS) {
    const permission = entity.permissions[verb.key];
    if (!permission) continue;

    const requirement = {
      permission,
      capability: verb.manages
        ? entity.capability.manage
        : entity.capability.read,
    };

    if (allowsAccess(requirement, access)) allowed.push(verb.label);
    else
      blocked.push({ label: verb.label, by: blockedBy(requirement, access) });
  }

  for (const action of actions) {
    if (!EXTRA_CATEGORIES.includes(action.category)) continue;
    /* `available: false` não é sobre esta conta — é contrato que não existe na
       plataforma inteira. Não entra num resumo de acesso. */
    if (action.available === false) continue;

    const label = action.label.toLocaleLowerCase("pt-BR");
    if (allowsAccess(action, access)) allowed.push(label);
    else if (accessBlockReason(action, access)) {
      blocked.push({ label, by: blockedBy(action, access) });
    }
  }

  return { id: entity.id, name: entity.labelPlural, allowed, blocked };
}

/** Uma linha por entidade, em ordem alfabética do nome exibido. */
export function buildAccessSummary(access: AccessContext): AccessArea[] {
  const byEntity = new Map<string, ActionDefinition[]>();
  for (const action of allActions()) {
    byEntity.set(action.entity, [
      ...(byEntity.get(action.entity) ?? []),
      action,
    ]);
  }

  return allEntities()
    .map((entity) => areaFor(entity, byEntity.get(entity.id) ?? [], access))
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}

/** "consultar, cadastrar e editar" — e não "consultar, cadastrar, editar". */
export function enumerate(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}
