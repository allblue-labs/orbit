/**
 * Action Registry — o catálogo do que se pode fazer com uma entidade.
 *
 * Os outros registries cobrem apresentação: o que uma entidade é, o que uma
 * métrica significa, como um campo se desenha, o que um documento emitido é.
 * Faltava o eixo das **ações** — "criar", "duplicar", "arquivar", "renderizar"
 * — que até aqui vivia como botão escrito à mão em cada tela, cada um
 * repetindo o mesmo trio: qual permissão exige, qual capability exige, e se
 * precisa confirmar.
 *
 * ## O que ele descreve — e o que ele não faz
 *
 * **Ele descreve.** Rótulo, ícone, entidade dona, exigências, se é destrutiva,
 * em que superfícies aparece, e o texto da confirmação.
 *
 * **Ele não executa.** Não há `run` aqui, e a ausência é deliberada: executar
 * exige hooks (`useApiMutation`), e hooks não podem ser chamados de dentro de
 * um objeto literal. Ligar o registry à mutação é trabalho do componente —
 * `useAction(id)` responde "posso oferecer isto?", e o `onClick` continua
 * sendo o hook que a tela já usa.
 *
 * **Ele não autoriza.** Declara o que o backend exige; quem decide é o
 * servidor, que recusa com 403 independentemente do que esteja aqui. O que o
 * registry evita é oferecer um botão que já se sabe que seria recusado.
 *
 * **Ele não sabe regra de negócio.** Se a transição é válida, se o registro
 * pode ser excluído, se o limite do plano foi atingido — sempre do servidor.
 * `destructive` é uma dica de interface (peça confirmação), não uma regra.
 *
 * Ver `docs/action-registry.md`.
 */
import type { ComponentType } from "react";
import {
  Archive,
  ArrowLeftRight,
  Ban,
  CheckCheck,
  FileCheck,
  CircleX,
  CircleCheckBig,
  Copy,
  Download,
  Eye,
  FileOutput,
  FolderTree,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  Scale,
  Power,
  PowerOff,
  RefreshCw,
  ReceiptText,
  Send,
  Share2,
  ShoppingCart,
  ShieldCheck,
  Trash2,
  Undo2,
  UserPlus,
  FileBarChart,
  Zap,
  type LucideProps,
} from "lucide-react";

import { createRegistry, humanizeId, type AccessRequirement } from "@/registry";
import type { EntityId } from "@/entities/entity-registry";

export type ActionIcon = ComponentType<LucideProps>;

/**
 * Onde a ação pode aparecer.
 *
 * A mesma ação tem exigências diferentes conforme a superfície: um botão
 * primário cabe numa tela, um item de menu cabe numa linha de tabela, e a
 * paleta de comandos precisa de um rótulo que faça sentido fora de contexto.
 */
export const ACTION_SURFACES = ["primary", "menu", "row", "palette"] as const;
export type ActionSurface = (typeof ACTION_SURFACES)[number];

/**
 * Famílias de ação, para agrupar menus sem que cada tela invente a sua ordem.
 */
export const ACTION_CATEGORIES = [
  "create",
  "edit",
  "workflow",
  "document",
  "destructive",
] as const;
export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

export interface ActionDefinition extends AccessRequirement {
  /** `"<entidade>.<verbo>"` — ex.: `"artifact-template.duplicate"`. */
  readonly id: string;
  readonly entity: EntityId;
  readonly label: string;
  readonly description?: string;
  readonly icon: ActionIcon;
  readonly category: ActionCategory;
  readonly surfaces: readonly ActionSurface[];
  /** Pede confirmação antes de executar. */
  readonly destructive?: boolean;
  /** Texto da confirmação — obrigatório quando destrutiva. */
  readonly confirm?: {
    readonly title: string;
    readonly body: string;
    readonly confirmLabel: string;
  };
}

/**
 * Fábrica com os padrões de cada categoria.
 *
 * Ação destrutiva já nasce pedindo confirmação; ação de criação já nasce como
 * botão primário. São os padrões que cada tela vinha repetindo à mão.
 */
function define(
  input: Omit<ActionDefinition, "surfaces" | "destructive"> &
    Partial<Pick<ActionDefinition, "surfaces" | "destructive">>,
): ActionDefinition {
  const destructive = input.destructive ?? input.category === "destructive";
  const surfaces =
    input.surfaces ??
    (input.category === "create"
      ? (["primary", "palette"] as const)
      : (["menu", "row"] as const));

  return { ...input, destructive, surfaces };
}

const DEFINITIONS: readonly ActionDefinition[] = [
  /* ---------------------------------------------------------------- */
  /* Relatórios gerenciais (recurso `management-reports` no backend)   */
  /* ---------------------------------------------------------------- */
  /**
   * A capability declarada é a do **motor**.
   *
   * Cada tipo de relatório exige ainda a do seu domínio — o financeiro exige
   * `financial.read` —, e quem publica essa exigência é o catálogo do backend,
   * por tipo, com `allowed` já resolvido para a sessão. O registry não tem onde
   * guardar uma exigência que muda de linha para linha, e duplicá-la aqui
   * criaria uma segunda régua que divergiria no primeiro tipo novo.
   */
  define({
    id: "management-report.create",
    entity: "management-report",
    label: "Gerar relatório",
    description:
      "Compõe o retrato de um período. A geração acontece em segundo plano.",
    icon: FileBarChart,
    category: "create",
    permission: "reports.management.manage",
    capability: "reports.management.manage",
  }),
  define({
    id: "management-report.open",
    entity: "management-report",
    label: "Abrir",
    icon: Eye,
    category: "edit",
    permission: "reports.management.read",
    capability: "reports.management.read",
  }),
  define({
    id: "management-report.download",
    entity: "management-report",
    label: "Baixar",
    description: "O link de acesso é temporário e pessoal.",
    icon: Download,
    category: "document",
    permission: "reports.management.read",
    capability: "reports.management.read",
  }),
  /**
   * "Gerar de novo" é **criar outro**, não regenerar.
   *
   * Não existe rota que recomponha um relatório: o snapshot é imutável, e é
   * essa imutabilidade que o torna prova. O que esta ação faz é abrir o
   * gerador com os mesmos parâmetros — o resultado é um retrato novo, ao lado
   * do antigo, e os dois ficam no histórico.
   */
  define({
    id: "management-report.repeat",
    entity: "management-report",
    label: "Gerar de novo",
    description:
      "Abre a geração com os mesmos parâmetros. O relatório antigo permanece.",
    icon: RefreshCw,
    category: "workflow",
    permission: "reports.management.manage",
    capability: "reports.management.manage",
  }),

  /* ---------------------------------------------------------------- */
  /* Automações (recurso `automations` no backend)                     */
  /* ---------------------------------------------------------------- */
  define({
    id: "automation-rule.create",
    entity: "automation-rule",
    label: "Nova automação",
    description: "Quando algo acontecer, o Orbit faz o que foi combinado.",
    icon: Zap,
    category: "create",
    permission: "automations.manage",
    capability: "automations.manage",
  }),
  define({
    id: "automation-rule.update",
    entity: "automation-rule",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "automations.manage",
    capability: "automations.manage",
  }),
  /**
   * Ligar e desligar é `POST /:id/toggle`, não edição.
   *
   * Declaradas à parte porque é assim que se pensa nelas — e porque desligar
   * **não cancela** o que já está agendado: a ação pendente é descartada na
   * hora de executar, com o motivo. A exigência é a mesma da edição.
   */
  define({
    id: "automation-rule.enable",
    entity: "automation-rule",
    label: "Ativar",
    icon: Power,
    category: "workflow",
    permission: "automations.manage",
    capability: "automations.manage",
  }),
  define({
    id: "automation-rule.disable",
    entity: "automation-rule",
    label: "Desativar",
    description:
      "A regra para de valer. Ações já agendadas são descartadas quando chegar a hora.",
    icon: PowerOff,
    category: "workflow",
    permission: "automations.manage",
    capability: "automations.manage",
  }),
  define({
    id: "automation-rule.duplicate",
    entity: "automation-rule",
    label: "Duplicar",
    description: "A cópia nasce desativada, para ser ajustada antes de valer.",
    icon: Copy,
    category: "edit",
    permission: "automations.manage",
    capability: "automations.manage",
  }),
  /**
   * Excluir é recusado com 409 enquanto houver ação agendada.
   *
   * A condição é do servidor e não está copiada aqui: o texto da confirmação
   * avisa que pode ser recusada, e a recusa chega com a contagem real de
   * pendências.
   */
  define({
    id: "automation-rule.delete",
    entity: "automation-rule",
    label: "Excluir",
    icon: Trash2,
    category: "destructive",
    permission: "automations.manage",
    capability: "automations.manage",
    confirm: {
      title: "Excluir esta automação?",
      body: "A regra some das Configurações e para de valer. Se ainda houver ação agendada e não executada — um lembrete futuro, por exemplo —, a exclusão não é permitida: desative a regra e espere, ou deixe-a desativada.",
      confirmLabel: "Excluir",
    },
  }),

  /* ---------------------------------------------------------------- */
  /* Equipamentos (recurso `assets` no backend)                        */
  /* ---------------------------------------------------------------- */
  define({
    id: "asset.create",
    entity: "asset",
    label: "Novo equipamento",
    icon: Plus,
    category: "create",
    permission: "assets.create",
    capability: "assets.manage",
  }),
  define({
    id: "asset.update",
    entity: "asset",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "assets.update",
    capability: "assets.manage",
  }),
  /**
   * Ativar e desativar são `PATCH /assets/:id` com `status`.
   *
   * `UpdateAssetDto` aceita o campo — é a única forma suportada de mudar o
   * estado, e não existe endpoint dedicado. Declaradas como ações próprias
   * porque é assim que o usuário pensa nelas; a exigência é a mesma da edição.
   */
  define({
    id: "asset.activate",
    entity: "asset",
    label: "Reativar",
    description: "Volta o equipamento para ACTIVE.",
    icon: Power,
    category: "workflow",
    permission: "assets.update",
    capability: "assets.manage",
  }),
  define({
    id: "asset.deactivate",
    entity: "asset",
    label: "Desativar",
    description: "Marca o equipamento como INACTIVE. O histórico permanece.",
    icon: PowerOff,
    category: "workflow",
    permission: "assets.update",
    capability: "assets.manage",
  }),
  define({
    id: "asset.delete",
    entity: "asset",
    label: "Excluir",
    icon: Trash2,
    category: "destructive",
    permission: "assets.delete",
    capability: "assets.manage",
    confirm: {
      title: "Excluir este equipamento?",
      body: "O equipamento deixa de aparecer nas listagens. O histórico de operações e execuções permanece.",
      confirmLabel: "Excluir",
    },
  }),

  /* ---------------------------------------------------------------- */
  /* Operações                                                         */
  /* ---------------------------------------------------------------- */
  define({
    id: "operation.create",
    entity: "operation",
    label: "Nova operação",
    icon: Plus,
    category: "create",
    permission: "operations.create",
    capability: "operations.manage",
  }),
  define({
    id: "operation.update",
    entity: "operation",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "operations.update",
    capability: "operations.manage",
  }),

  /* ---------------------------------------------------------------- */
  /* Catálogo — produtos, serviços e peças                             */
  /* ---------------------------------------------------------------- */
  define({
    id: "catalog-item.create",
    entity: "catalog-item",
    label: "Novo item",
    description: "Produto, serviço ou peça oferecido pela organização.",
    icon: Plus,
    category: "create",
    permission: "catalog.products.create",
    capability: "catalog.manage",
  }),
  define({
    id: "catalog-item.update",
    entity: "catalog-item",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "catalog.products.update",
    capability: "catalog.manage",
  }),
  /**
   * Disponibilizar e retirar de circulação.
   *
   * São `PATCH /catalog/products/:id` com `status`. Um item indisponível
   * continua existindo e continua referenciado por registros anteriores —
   * é a diferença entre "não oferecemos mais isto" e "isto nunca existiu".
   */
  define({
    id: "catalog-item.activate",
    entity: "catalog-item",
    label: "Disponibilizar",
    description: "Volta a oferecer o item.",
    icon: Power,
    category: "workflow",
    permission: "catalog.products.update",
    capability: "catalog.manage",
  }),
  define({
    id: "catalog-item.deactivate",
    entity: "catalog-item",
    label: "Retirar de circulação",
    description: "O item deixa de ser oferecido, mas permanece no histórico.",
    icon: PowerOff,
    category: "workflow",
    permission: "catalog.products.update",
    capability: "catalog.manage",
  }),
  define({
    id: "catalog-item.delete",
    entity: "catalog-item",
    label: "Excluir",
    icon: Trash2,
    category: "destructive",
    permission: "catalog.products.delete",
    capability: "catalog.manage",
    confirm: {
      title: "Excluir este item do catálogo?",
      body: 'Ele some das listagens. Para apenas parar de oferecê-lo, use "Retirar de circulação" — assim o registro permanece.',
      confirmLabel: "Excluir",
    },
  }),
  define({
    id: "catalog-item.create-category",
    entity: "catalog-item",
    label: "Nova categoria",
    icon: FolderTree,
    category: "create",
    surfaces: ["primary"],
    permission: "catalog.categories.create",
    capability: "catalog.manage",
  }),
  define({
    id: "catalog-item.update-category",
    entity: "catalog-item",
    label: "Editar categoria",
    icon: Pencil,
    category: "edit",
    permission: "catalog.categories.update",
    capability: "catalog.manage",
  }),
  define({
    id: "catalog-item.delete-category",
    entity: "catalog-item",
    label: "Excluir categoria",
    icon: Trash2,
    category: "destructive",
    permission: "catalog.categories.delete",
    capability: "catalog.manage",
    confirm: {
      title: "Excluir esta categoria?",
      body: "Não é possível excluir enquanto houver subcategorias ou itens vinculados. Mova-os antes.",
      confirmLabel: "Excluir",
    },
  }),

  /* ---------------------------------------------------------------- */
  /* Equipe                                                            */
  /* ---------------------------------------------------------------- */
  define({
    id: "team-member.create",
    entity: "team-member",
    label: "Convidar pessoa",
    description:
      "Envia um convite por e-mail. A pessoa define a própria senha ao aceitar.",
    icon: UserPlus,
    category: "create",
    permission: "identity.invitations.create",
  }),
  define({
    id: "team-member.resend-invitation",
    entity: "team-member",
    label: "Reenviar convite",
    description: "Gera um link novo. O anterior deixa de valer.",
    icon: Send,
    category: "workflow",
    permission: "identity.invitations.create",
  }),
  define({
    id: "team-member.revoke-invitation",
    entity: "team-member",
    label: "Cancelar convite",
    icon: Trash2,
    category: "destructive",
    permission: "identity.invitations.create",
    confirm: {
      title: "Cancelar este convite?",
      body: "O link deixa de funcionar imediatamente. O registro permanece para auditoria, e a pessoa pode ser convidada de novo depois.",
      confirmLabel: "Cancelar convite",
    },
  }),
  /**
   * Editar membro e trocar papel não existem em contrato.
   *
   * Não há `PATCH /organizations/current/members/:id`, e `roleId` só é
   * informado no convite. `available: false` declara a ausência em vez de
   * esconder a ação — quando a rota existir, vira `true` e nada mais muda.
   */
  define({
    id: "team-member.update",
    entity: "team-member",
    label: "Editar membro",
    icon: Pencil,
    category: "edit",
    available: false,
    unavailableReason:
      "Nome, e-mail e foto pertencem ao perfil de cada pessoa, e só ela pode alterá-los.",
  }),
  define({
    id: "team-member.change-role",
    entity: "team-member",
    label: "Trocar papel",
    icon: ShieldCheck,
    category: "workflow",
    available: false,
    unavailableReason:
      "Não há rota para alterar o papel de um membro. O papel é definido no convite e só muda por lá.",
  }),
  define({
    id: "team-member.deactivate",
    entity: "team-member",
    label: "Desativar membro",
    icon: PowerOff,
    category: "workflow",
    available: false,
    unavailableReason:
      "A coluna de situação da associação existe e é publicada, mas nenhuma rota a escreve.",
  }),

  /* ---------------------------------------------------------------- */
  /* Clientes                                                          */
  /* ---------------------------------------------------------------- */
  define({
    id: "customer.create",
    entity: "customer",
    label: "Novo cliente",
    icon: Plus,
    category: "create",
    permission: "customers.create",
    capability: "crm.manage",
  }),
  define({
    id: "customer.update",
    entity: "customer",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "customers.update",
    capability: "crm.manage",
  }),

  /* ---------------------------------------------------------------- */
  /* Agenda                                                            */
  /* ---------------------------------------------------------------- */
  define({
    id: "scheduling-event.create",
    entity: "scheduling-event",
    label: "Novo agendamento",
    icon: Plus,
    category: "create",
    permission: "scheduling.events.create",
    capability: "scheduling.manage",
  }),
  define({
    id: "scheduling-event.update",
    entity: "scheduling-event",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "scheduling.events.update",
    capability: "scheduling.manage",
  }),
  define({
    id: "scheduling-event.delete",
    entity: "scheduling-event",
    label: "Cancelar agendamento",
    icon: Trash2,
    category: "destructive",
    permission: "scheduling.events.delete",
    capability: "scheduling.manage",
    confirm: {
      title: "Cancelar este agendamento?",
      body: "O compromisso sai da agenda. Os participantes não são notificados automaticamente.",
      confirmLabel: "Cancelar agendamento",
    },
  }),

  /* ---------------------------------------------------------------- */
  /* Templates de artefato                                             */
  /* ---------------------------------------------------------------- */
  define({
    id: "artifact-template.create",
    entity: "artifact-template",
    label: "Novo template",
    icon: Plus,
    category: "create",
    permission: "artifact_templates.create",
    capability: "artifact_templates.manage",
  }),
  define({
    id: "artifact-template.duplicate",
    entity: "artifact-template",
    label: "Duplicar",
    description:
      "Cria um rascunho independente com a mesma estrutura. O original não muda.",
    icon: Copy,
    category: "edit",
    permission: "artifact_templates.create",
    capability: "artifact_templates.manage",
  }),
  define({
    id: "artifact-template.publish",
    entity: "artifact-template",
    label: "Publicar versão",
    description: "Congela a estrutura atual como uma nova versão imutável.",
    icon: Send,
    category: "workflow",
    permission: "artifact_templates.update",
    capability: "artifact_templates.manage",
  }),
  define({
    id: "artifact-template.archive",
    entity: "artifact-template",
    label: "Arquivar",
    icon: Archive,
    category: "destructive",
    permission: "artifact_templates.delete",
    capability: "artifact_templates.manage",
    confirm: {
      title: "Arquivar este template?",
      body: "Ele deixa de aparecer para novas execuções. As execuções já criadas continuam válidas.",
      confirmLabel: "Arquivar",
    },
  }),

  /* ---------------------------------------------------------------- */
  /* Execuções                                                         */
  /* ---------------------------------------------------------------- */
  define({
    id: "artifact-execution.create",
    entity: "artifact-execution",
    label: "Nova execução",
    icon: Plus,
    category: "create",
    permission: "artifact_executions.create",
    capability: "artifact_executions.manage",
  }),
  define({
    id: "artifact-execution.submit",
    entity: "artifact-execution",
    label: "Submeter",
    description:
      "Envia para revisão. O preenchimento é conferido antes de seguir.",
    icon: CheckCheck,
    category: "workflow",
    permission: "artifact_executions.update",
    capability: "artifact_executions.manage",
  }),
  define({
    id: "artifact-execution.reopen",
    entity: "artifact-execution",
    label: "Reabrir",
    icon: Undo2,
    category: "workflow",
    permission: "artifact_executions.update",
    capability: "artifact_executions.manage",
  }),
  define({
    id: "artifact-execution.render",
    entity: "artifact-execution",
    label: "Renderizar documento",
    description: "Gera uma nova revisão a partir das respostas atuais.",
    icon: FileOutput,
    category: "document",
    permission: "artifact_rendering.render",
    capability: "artifact_rendering.render",
  }),
  define({
    id: "artifact-execution.preview-document",
    entity: "artifact-execution",
    label: "Visualizar documento",
    icon: Eye,
    category: "document",
    permission: "artifact_manifests.read",
    capability: "artifact_manifests.read",
  }),
  /**
   * Rascunho, não revisão.
   *
   * `preview-document` abre um documento **emitido** — por isso pede
   * `artifact_manifests.read`. Este abre o que sairia se a emissão fosse
   * agora: não há manifesto para ler, e a autorização é a mesma da rota
   * (`GET /artifact-executions/:id/preview`), que é leitura da execução.
   *
   * Separar as duas importa porque quem revisa antes de emitir muitas vezes
   * não tem acesso ao acervo emitido, e vice-versa.
   */
  define({
    id: "artifact-execution.preview-draft",
    entity: "artifact-execution",
    label: "Pré-visualizar",
    description: "Mostra como o documento sairia, sem emitir nem versionar.",
    icon: Eye,
    category: "document",
    permission: "artifact_executions.read",
    capability: "artifact_executions.read",
  }),
  define({
    id: "artifact-execution.download-document",
    entity: "artifact-execution",
    label: "Baixar documento",
    icon: Download,
    category: "document",
    permission: "artifact_manifests.read",
    capability: "artifact_manifests.read",
  }),
  define({
    id: "artifact-execution.revoke-document",
    entity: "artifact-execution",
    label: "Revogar documento",
    icon: RefreshCw,
    category: "destructive",
    permission: "artifact_manifests.revoke",
    capability: "artifact_manifests.manage",
    confirm: {
      title: "Revogar esta revisão?",
      body: "O documento deixa de ser distribuído. O registro permanece para auditoria e o motivo é obrigatório.",
      confirmLabel: "Revogar",
    },
  }),
  /**
   * Compartilhar não tem contrato.
   *
   * `available: false` declara a ausência em vez de esconder: a URL assinada é
   * curta e pessoal, e não existe endpoint que crie link público ou envie por
   * e-mail. Quando existir, vira `true` e nada mais muda.
   */
  /* ---------------------------------------------------------------- */
  /* Estoque                                                           */
  /* ---------------------------------------------------------------- */
  /**
   * As ações de estoque pertencem ao **item do catálogo**.
   *
   * Não há entidade `inventory-movement` no Entity Registry, e não deveria
   * haver: movimento não tem tela própria, não tem rota e não é navegável —
   * registrá-lo só para pendurar ações criaria uma entidade que nunca é o
   * destino de um link. As ações vivem onde a pessoa está quando decide
   * executá-las: no item.
   *
   * A capability é `inventory.manage`, independente de `catalog.manage`: mexer
   * na tabela de preços não é mexer na prateleira.
   */
  define({
    id: "catalog-item.stock-entry",
    entity: "catalog-item",
    label: "Registrar entrada",
    description: "Material que chegou à unidade.",
    icon: PackagePlus,
    category: "workflow",
    permission: "inventory.manage",
    capability: "inventory.manage",
  }),
  define({
    id: "catalog-item.stock-consumption",
    entity: "catalog-item",
    label: "Registrar consumo",
    description: "Material usado em um trabalho.",
    icon: PackageMinus,
    category: "workflow",
    permission: "inventory.manage",
    capability: "inventory.manage",
  }),
  define({
    id: "catalog-item.stock-return",
    entity: "catalog-item",
    label: "Registrar devolução",
    description: "Material que voltou da visita sem ser usado.",
    icon: Undo2,
    category: "workflow",
    permission: "inventory.manage",
    capability: "inventory.manage",
  }),
  /**
   * Ajuste é destrutivo na interface — pede confirmação e motivo.
   *
   * Não porque apaga algo: **nada é apagado**. Porque é a única operação que
   * altera o saldo sem um fato externo que a explique, e é onde estoque some
   * sem rastro em sistemas que a tratam como digitação comum.
   */
  define({
    id: "catalog-item.stock-adjustment",
    entity: "catalog-item",
    label: "Ajustar contagem",
    description: "Diferença encontrada na conferência física.",
    icon: Scale,
    category: "destructive",
    permission: "inventory.manage",
    capability: "inventory.manage",
    confirm: {
      title: "Registrar ajuste de contagem?",
      body: "O ajuste não corrige o saldo por edição: ele cria uma movimentação no histórico, com motivo e autor. O saldo anterior continua explicável.",
      confirmLabel: "Registrar ajuste",
    },
  }),
  define({
    id: "catalog-item.stock-transfer",
    entity: "catalog-item",
    label: "Transferir entre unidades",
    description: "Sai de uma unidade e entra na outra, na mesma operação.",
    icon: ArrowLeftRight,
    category: "workflow",
    permission: "inventory.manage",
    capability: "inventory.manage",
  }),
  define({
    id: "catalog-item.stock-minimum",
    entity: "catalog-item",
    label: "Definir estoque mínimo",
    description: "Política de reposição do item nesta unidade.",
    icon: Pencil,
    category: "edit",
    permission: "inventory.manage",
    capability: "inventory.manage",
  }),
  /**
   * Reserva — sem contrato.
   *
   * O backend publica `reserved` e `available` na projeção, mas **nenhuma rota
   * reserva**: falta um reservador com ciclo de vida. Declarada indisponível
   * em vez de omitida, porque `available` aparece na tela e a pergunta "como
   * eu reservo?" vem logo depois.
   */
  define({
    id: "catalog-item.stock-reserve",
    entity: "catalog-item",
    label: "Reservar material",
    icon: Archive,
    category: "workflow",
    available: false,
    unavailableReason:
      "Reservar material para um atendimento ainda não está disponível. O saldo mostra o que está reservado e o que está livre, mas a reserva em si ainda não pode ser feita aqui.",
  }),

  /* ---------------------------------------------------------------- */
  /* Orçamentos                                                        */
  /* ---------------------------------------------------------------- */
  define({
    id: "quote.create",
    entity: "quote",
    label: "Novo orçamento",
    description: "Proposta comercial para um cliente.",
    icon: Plus,
    category: "create",
    permission: "quotes.manage",
    capability: "quotes.manage",
  }),
  define({
    id: "quote.update",
    entity: "quote",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "quotes.manage",
    capability: "quotes.manage",
  }),
  /**
   * As quatro transições.
   *
   * O registry declara **quem pode ver o botão**; se a proposta aceita a
   * transição **agora** é o `transitions` que o backend publica em cada
   * orçamento. Duplicar a máquina de estados aqui criaria a segunda, e as duas
   * divergiriam no primeiro estado novo.
   */
  define({
    id: "quote.send",
    entity: "quote",
    label: "Enviar ao cliente",
    description: "Registra o envio. A proposta deixa de aceitar alterações.",
    icon: Send,
    category: "workflow",
    permission: "quotes.manage",
    capability: "quotes.manage",
  }),
  define({
    id: "quote.approve",
    entity: "quote",
    label: "Registrar aprovação",
    description:
      "O cliente aceitou. Gera receita prevista — não recebida — no Financeiro.",
    icon: CheckCheck,
    category: "workflow",
    permission: "quotes.manage",
    capability: "quotes.manage",
  }),
  /**
   * Emitir o documento é diferente de baixar o PDF.
   *
   * Baixar renderiza a proposta atual e não deixa rastro — serve para conferir
   * antes de mandar. Emitir cria um documento com código, revisão e hash, que
   * aparece em Relatórios › Documentos emitidos e continua recuperável depois de
   * a proposta mudar. Por isso pede `quotes.manage`, e não `quotes.read`.
   */
  define({
    id: "quote.issueDocument",
    entity: "quote",
    label: "Emitir documento",
    description:
      "Cria o documento oficial da proposta, com código e revisão. Fica guardado e recuperável; baixar o PDF não.",
    icon: FileCheck,
    category: "workflow",
    permission: "quotes.manage",
    capability: "quotes.manage",
  }),
  define({
    id: "quote.reject",
    entity: "quote",
    label: "Registrar recusa",
    icon: CircleX,
    category: "workflow",
    permission: "quotes.manage",
    capability: "quotes.manage",
  }),
  define({
    id: "quote.cancel",
    entity: "quote",
    label: "Cancelar proposta",
    icon: Ban,
    category: "destructive",
    permission: "quotes.manage",
    capability: "quotes.manage",
    confirm: {
      title: "Cancelar esta proposta?",
      body: "Ela deixa de valer e o motivo fica registrado. Se já havia receita prevista, ela é cancelada — não apagada. Uma operação já criada por conversão não é desfeita.",
      confirmLabel: "Cancelar proposta",
    },
  }),
  /**
   * Conversão em operação.
   *
   * Exige também `operations.manage`: abrir trabalho em campo é ato do domínio
   * de operações, e é a dupla exigência que o backend aplica.
   */
  define({
    id: "quote.convert",
    entity: "quote",
    label: "Converter em operação",
    description: "Abre a ordem de serviço correspondente à proposta aprovada.",
    icon: ShoppingCart,
    category: "workflow",
    permission: "quotes.manage",
    capability: "operations.manage",
  }),
  define({
    id: "quote.delete",
    entity: "quote",
    label: "Excluir rascunho",
    icon: Trash2,
    category: "destructive",
    permission: "quotes.manage",
    capability: "quotes.manage",
    confirm: {
      title: "Excluir este rascunho?",
      body: "Só rascunhos podem ser excluídos. Proposta já enviada é cancelada, para que o motivo e o histórico permaneçam.",
      confirmLabel: "Excluir",
    },
  }),
  /**
   * Documento da proposta — sem contrato.
   *
   * O template oficial `ORBIT_ORCAMENTO` existe e o Rendering Engine sabe
   * emiti-lo, mas **não há mapeamento Quote → ArtifactExecution** no backend:
   * nada transforma os itens do orçamento nas seções do template. Declarado
   * como indisponível em vez de omitido — e nenhum PDF é gerado aqui, porque
   * um segundo gerador seria a segunda verdade sobre o que é um documento
   * emitido.
   */
  define({
    id: "quote.document",
    entity: "quote",
    label: "Gerar documento",
    icon: ReceiptText,
    category: "document",
    available: false,
    unavailableReason:
      "A emissão do orçamento em PDF ainda não está disponível.",
  }),

  /* ---------------------------------------------------------------- */
  /* Financeiro                                                        */
  /* ---------------------------------------------------------------- */
  define({
    id: "financial-entry.create",
    entity: "financial-entry",
    label: "Novo lançamento",
    description: "Receita ou despesa registrada manualmente.",
    icon: Plus,
    category: "create",
    permission: "financial.manage",
    capability: "financial.manage",
  }),
  /**
   * Editar só existe para lançamento manual.
   *
   * A ação é declarada uma vez; quem decide se **esta linha** pode ser editada
   * é o `editable` que o backend publica no próprio lançamento. O registry não
   * conhece o registro, só a exigência — e é por isso que a lista não tem
   * "editar recibo".
   */
  define({
    id: "financial-entry.update",
    entity: "financial-entry",
    label: "Editar",
    icon: Pencil,
    category: "edit",
    permission: "financial.manage",
    capability: "financial.manage",
  }),
  define({
    id: "financial-entry.confirm",
    entity: "financial-entry",
    label: "Confirmar",
    description: "O dinheiro entrou ou saiu de fato.",
    icon: CircleCheckBig,
    category: "workflow",
    permission: "financial.manage",
    capability: "financial.manage",
  }),
  /**
   * Cancelar não é excluir.
   *
   * Destrutiva na interface — pede confirmação e motivo —, mas o registro
   * permanece: um valor que sumiu do caixa sem explicação é a pergunta que
   * ninguém responde três meses depois.
   */
  define({
    id: "financial-entry.cancel",
    entity: "financial-entry",
    label: "Cancelar lançamento",
    icon: Ban,
    category: "destructive",
    permission: "financial.manage",
    capability: "financial.manage",
    confirm: {
      title: "Cancelar este lançamento?",
      body: "Ele deixa de contar no saldo, mas continua na base com motivo, autor e data. Nada é apagado.",
      confirmLabel: "Cancelar lançamento",
    },
  }),
  define({
    id: "financial-entry.create-category",
    entity: "financial-entry",
    label: "Nova categoria",
    icon: FolderTree,
    category: "create",
    surfaces: ["primary"],
    permission: "financial.manage",
    capability: "financial.manage",
  }),
  define({
    id: "financial-entry.update-category",
    entity: "financial-entry",
    label: "Editar categoria",
    icon: Pencil,
    category: "edit",
    permission: "financial.manage",
    capability: "financial.manage",
  }),
  define({
    id: "financial-entry.delete-category",
    entity: "financial-entry",
    label: "Excluir categoria",
    icon: Trash2,
    category: "destructive",
    permission: "financial.manage",
    capability: "financial.manage",
    confirm: {
      title: "Excluir esta categoria?",
      body: "Não é possível excluir uma categoria em uso por lançamentos. As categorias padrão do Orbit também não podem ser removidas.",
      confirmLabel: "Excluir",
    },
  }),
  /**
   * Exportar não tem contrato.
   *
   * Não existe endpoint que produza CSV, XLSX ou PDF do financeiro — nem em
   * `/financial`, nem no Document Center, cujos artefatos são documentos de
   * execução, não relatórios. Declarado como indisponível em vez de omitido:
   * é a pergunta que todo mundo faz na primeira semana de uso.
   */
  define({
    id: "financial-entry.export",
    entity: "financial-entry",
    label: "Exportar lançamentos",
    icon: Download,
    category: "document",
    available: false,
    unavailableReason:
      "A exportação do financeiro ainda não está disponível. Os documentos emitidos hoje são os de atendimento.",
  }),
  define({
    id: "artifact-execution.share-document",
    entity: "artifact-execution",
    label: "Compartilhar documento",
    icon: Share2,
    category: "document",
    available: false,
    unavailableReason:
      "Compartilhar por link público ou e-mail ainda não está disponível. O acesso ao documento é pessoal e temporário.",
  }),
];

const registry = createRegistry<ActionDefinition>({
  name: "actions",
  source: "src/actions/action-registry.ts",
  entries: DEFINITIONS,
  /**
   * Ação destrutiva sem texto de confirmação é erro de declaração.
   *
   * O componente que pede a confirmação lê o texto daqui; sem ele, o diálogo
   * apareceria vazio. Verificado só em desenvolvimento — em produção o pior
   * caso é um diálogo genérico, e não uma tela quebrada.
   */
  validate: (action) =>
    action.destructive && !action.confirm
      ? "ação destrutiva precisa declarar `confirm`"
      : null,
  derive: (id) => ({
    id,
    entity: (id.split(".")[0] ?? "asset") as EntityId,
    label: humanizeId(id.split(".").slice(1).join(".") || id),
    icon: Plus,
    category: "edit",
    surfaces: ["menu"],
    available: false,
    unavailableReason: "Ação ainda não registrada.",
  }),
});

export function allActions(): readonly ActionDefinition[] {
  return registry.all();
}

/** A ação declarada, ou `undefined` — a superfície simplesmente não a oferece. */
export function getAction(id: string): ActionDefinition | undefined {
  return registry.get(id);
}

/** A ação, sempre — derivada e indisponível quando não é declarada. */
export function resolveAction(id: string): ActionDefinition {
  return registry.resolve(id);
}

/** Ações de uma entidade, opcionalmente recortadas por superfície. */
export function actionsFor(
  entity: EntityId,
  surface?: ActionSurface,
): readonly ActionDefinition[] {
  return registry
    .all()
    .filter(
      (action) =>
        action.entity === entity &&
        (surface === undefined || action.surfaces.includes(surface)),
    );
}
