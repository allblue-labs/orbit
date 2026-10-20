/**
 * Entity Registry — definição única de como cada entidade da plataforma se
 * apresenta e o que se pode fazer com ela.
 *
 * Mesma filosofia do Metric Registry, do Widget Registry e do Field Registry:
 * o backend publica **dados e autorização**; o que ele não publica é rótulo,
 * ícone, cor, rota, quais ações a interface oferece e como um status vira
 * texto. Sem um lugar para isso, a decisão se espalha — e é exatamente o
 * `switch (entidade)` que esta camada existe para eliminar.
 *
 * Regras, iguais às dos outros registries:
 *
 * - **Nenhum componente decide apresentação de entidade.** Ele resolve pelo
 *   registry e renderiza o que voltar.
 * - **O registry não autoriza nada.** Ele declara qual capability e qual
 *   permissão o backend exige; quem decide continua sendo o servidor, e a
 *   sessão só evita oferecer o que seria recusado.
 * - **Entidade desconhecida não quebra a tela.** `resolveEntity` devolve uma
 *   definição derivada, com aviso em desenvolvimento.
 *
 * Os mapas de rótulo de status **não são copiados** para cá: cada módulo já
 * tem o seu, e o registry aponta para ele. Duas fontes divergiriam no primeiro
 * status novo.
 *
 * Para registrar uma entidade nova, ver `docs/entity-registry.md`.
 */
import type { ComponentType } from "react";
import {
  Boxes,
  CalendarClock,
  ClipboardCheck,
  Handshake,
  LayoutTemplate,
  PackageSearch,
  ReceiptText,
  Route,
  UsersRound,
  Wallet,
  Workflow,
  FileBarChart,
  Zap,
  type LucideProps,
} from "lucide-react";

import { createRegistry } from "@/registry";
import { ROUTES } from "@/lib/routes";
import { PLAN_STATUS } from "@/registry/pmoc";
import { CONFIGURATION_STATUS } from "@/registry/rvt";
import { OPERATION_STATUS_LABELS } from "@/types/operations";
import { ARTIFACT_EXECUTION_STATUS_LABELS } from "@/components/artifact-executions/execution-badges";
import { SCHEDULING_STATUS_LABELS } from "@/components/scheduling/event-badges";
import { ASSET_STATUS_LABELS, ASSET_CATEGORY_LABELS } from "./asset-labels";
import { CATALOG_KIND_LABELS, CATALOG_STATUS_LABELS } from "./catalog-labels";
import {
  INVITATION_STATUS_LABELS,
  MEMBER_STATUS_LABELS,
} from "./workforce-labels";
import {
  FINANCIAL_SOURCE_CLASSES,
  FINANCIAL_SOURCE_LABELS,
  FINANCIAL_STATUS_CLASSES,
  FINANCIAL_STATUS_LABELS,
  FINANCIAL_TYPE_CLASSES,
  FINANCIAL_TYPE_LABELS,
} from "./financial-labels";
import { QUOTE_STATUS_CLASSES, QUOTE_STATUS_LABELS } from "./quote-labels";
import {
  REPORT_STATUS_CLASSES,
  REPORT_STATUS_LABELS,
} from "@/types/management-reports";

export type EntityIcon = ComponentType<LucideProps>;

/**
 * Identificadores das entidades registradas.
 *
 * São chaves internas de apresentação — não vêm do backend e não viajam pela
 * rede.
 */
export const ENTITY_IDS = [
  "asset",
  "automation-rule",
  "management-report",
  "catalog-item",
  "team-member",
  "operation",
  "customer",
  "artifact-template",
  "artifact-execution",
  "scheduling-event",
  "financial-entry",
  "quote",
  "pmoc-plan",
  "rvt-configuration",
] as const;
export type EntityId = (typeof ENTITY_IDS)[number];

/**
 * Conjunto de rótulos de um atributo categórico da entidade (status,
 * categoria, criticidade…).
 *
 * `labels` aponta para o mapa que o módulo dono já mantém. Valor fora do mapa
 * é exibido cru: um status novo do backend precisa aparecer, não sumir.
 */
export interface EntityBadgeSet {
  readonly label: string;
  readonly labels: Readonly<Record<string, string>>;
  readonly classes?: Readonly<Record<string, string>>;
}

export interface EntityDefinition {
  readonly id: EntityId;
  readonly label: string;
  readonly labelPlural: string;
  readonly description: string;
  readonly icon: EntityIcon;
  /** Classe de cor sobre tokens do Design System. */
  readonly color: string;
  /** Rota base da entidade; `href` monta o caminho do registro. */
  readonly basePath: string;
  readonly capability: { readonly read: string; readonly manage: string };
  readonly permissions: {
    readonly read: string;
    readonly create?: string;
    readonly update?: string;
    readonly delete?: string;
  };
  readonly badges: Readonly<Record<string, EntityBadgeSet>>;
  /** Caminho do registro. Ausente quando a entidade não tem tela própria. */
  readonly href?: (id: string) => string;
}

const OPERATION_STATUS_CLASSES: Readonly<Record<string, string>> = {
  SCHEDULED: "bg-surface-strong text-muted-foreground",
  IN_PROGRESS: "bg-primary/15 text-primary",
  PAUSED: "bg-amber-500/15 text-amber-400",
  COMPLETED: "bg-emerald-500/15 text-emerald-400",
  CANCELLED: "bg-surface-strong text-muted-foreground",
};

/**
 * Situação do plano de PMOC.
 *
 * Os rótulos vêm de `registry/pmoc.ts` — um mapa só para a aplicação inteira.
 * As classes ficam aqui, ao lado das dos outros badges do registry, pela mesma
 * razão que as de Operação ficam: é este arquivo que desenha o `EntityBadge`.
 */
const PMOC_PLAN_STATUS_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries(PLAN_STATUS).map(([status, presentation]) => [
      status,
      presentation.label,
    ]),
  );

const PMOC_PLAN_STATUS_CLASSES: Readonly<Record<string, string>> = {
  DRAFT: "bg-surface-strong text-muted-foreground",
  ACTIVE: "bg-emerald-500/15 text-emerald-400",
  SUSPENDED: "bg-amber-500/15 text-amber-400",
  EXPIRED: "bg-surface-strong text-muted-foreground",
  CANCELLED: "bg-surface-strong text-muted-foreground",
};

/**
 * A situação da **configuração** de RVT — não a da visita.
 *
 * "Inativa" é ausência de novas visitas, não erro: o histórico continua lá.
 * Por isso o cinza, e não o âmbar.
 */
const RVT_STATUS_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CONFIGURATION_STATUS).map(([status, presentation]) => [
    status,
    presentation.label,
  ]),
);

const RVT_STATUS_CLASSES: Readonly<Record<string, string>> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-400",
  INACTIVE: "bg-surface-strong text-muted-foreground",
  COMPLETED: "bg-surface-strong text-muted-foreground",
  CANCELLED: "bg-surface-strong text-muted-foreground",
};

const MEMBER_STATUS_CLASSES: Readonly<Record<string, string>> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-400",
  INACTIVE: "bg-surface-strong text-muted-foreground",
  SUSPENDED: "bg-amber-500/15 text-amber-400",
};

const INVITATION_STATUS_CLASSES: Readonly<Record<string, string>> = {
  PENDING: "bg-amber-500/15 text-amber-400",
  ACCEPTED: "bg-emerald-500/15 text-emerald-400",
  EXPIRED: "bg-surface-strong text-muted-foreground",
  REVOKED: "bg-destructive/15 text-destructive",
};

const CATALOG_STATUS_CLASSES: Readonly<Record<string, string>> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-400",
  INACTIVE: "bg-surface-strong text-muted-foreground",
};

const ASSET_STATUS_CLASSES: Readonly<Record<string, string>> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-400",
  MAINTENANCE: "bg-amber-500/15 text-amber-400",
  INACTIVE: "bg-surface-strong text-muted-foreground",
  RETIRED: "bg-destructive/15 text-destructive",
};

const DEFINITIONS: readonly EntityDefinition[] = [
  {
    id: "asset",
    /**
     * `asset` é o nome **técnico**, e continua sendo: é o recurso do backend
     * (`/assets`), a capability (`assets.read`) e o parâmetro de consulta que
     * três outros módulos aceitam. Renomear o contrato por motivo visual
     * quebraria tudo isso sem ganho nenhum.
     *
     * O que o usuário lê é **Equipamento** — o vocabulário do HVAC-R, e o que
     * a operação de campo de fato manuseia. É por isto que o registry existe:
     * um lugar onde o nome técnico e o nome humano se encontram.
     */
    label: "Equipamento",
    labelPlural: "Equipamentos",
    description:
      "Máquinas, condensadoras, evaporadoras e instalações sob contrato.",
    icon: Boxes,
    color: "text-sky-400",
    basePath: ROUTES.assets,
    capability: { read: "assets.read", manage: "assets.manage" },
    permissions: {
      read: "assets.read",
      create: "assets.create",
      update: "assets.update",
      delete: "assets.delete",
    },
    badges: {
      status: {
        label: "Status",
        labels: ASSET_STATUS_LABELS,
        classes: ASSET_STATUS_CLASSES,
      },
      category: { label: "Categoria", labels: ASSET_CATEGORY_LABELS },
    },
    href: (id) => `${ROUTES.assets}/${id}`,
  },
  {
    id: "operation",
    label: "Operação",
    labelPlural: "Operações",
    description: "Ordens de serviço executadas em campo.",
    icon: Workflow,
    color: "text-primary",
    basePath: ROUTES.operations,
    capability: { read: "operations.read", manage: "operations.manage" },
    permissions: {
      read: "operations.read",
      create: "operations.create",
      update: "operations.update",
    },
    badges: {
      status: {
        label: "Status",
        labels: OPERATION_STATUS_LABELS,
        classes: OPERATION_STATUS_CLASSES,
      },
    },
    href: (id) => `${ROUTES.operations}/${id}`,
  },
  {
    /**
     * A **configuração** de manutenção preventiva, não o ciclo nem a execução.
     *
     * A entrada da navegação leva ao contrato de manutenção: cobertura,
     * periodicidade e Responsável Técnico. Ciclos e execuções por equipamento
     * vivem dentro dele — não como itens paralelos de menu, porque não é assim
     * que a operação os procura.
     */
    id: "pmoc-plan",
    label: "PMOC",
    labelPlural: "PMOC",
    description:
      "Planos de manutenção preventiva: cobertura, periodicidade e responsável técnico.",
    icon: ClipboardCheck,
    color: "text-emerald-400",
    basePath: ROUTES.pmoc,
    capability: { read: "pmoc.read", manage: "pmoc.manage" },
    permissions: {
      read: "pmoc.read",
      create: "pmoc.manage",
      update: "pmoc.manage",
    },
    badges: {
      status: {
        label: "Situação",
        labels: PMOC_PLAN_STATUS_LABELS,
        classes: PMOC_PLAN_STATUS_CLASSES,
      },
    },
    href: (id) => `${ROUTES.pmoc}/${id}`,
  },
  {
    /**
     * A **configuração** da visita técnica, não a visita.
     *
     * A entrada leva à regra: cliente, local, periodicidade e procedimento.
     * Ocorrências e execuções vivem dentro dela — não como itens paralelos de
     * menu, porque não é assim que a operação as procura. E RVT não é uma
     * Operation com outro tipo: a Operation que aparece durante a visita é
     * projeção operacional, não a entidade principal.
     */
    id: "rvt-configuration",
    label: "RVT",
    labelPlural: "RVT",
    description:
      "Visitas técnicas: periodicidade, local, procedimento e responsável técnico.",
    icon: Route,
    color: "text-sky-400",
    basePath: ROUTES.rvt,
    capability: { read: "rvt.read", manage: "rvt.manage" },
    permissions: {
      read: "rvt.read",
      create: "rvt.manage",
      update: "rvt.manage",
    },
    badges: {
      status: {
        label: "Situação",
        labels: RVT_STATUS_LABELS,
        classes: RVT_STATUS_CLASSES,
      },
    },
    href: (id) => `${ROUTES.rvt}/${id}`,
  },
  {
    id: "scheduling-event",
    label: "Agendamento",
    labelPlural: "Agenda",
    description: "Visitas, manutenções, compromissos e bloqueios.",
    icon: CalendarClock,
    color: "text-violet-400",
    basePath: ROUTES.scheduling,
    capability: { read: "scheduling.read", manage: "scheduling.manage" },
    permissions: {
      read: "scheduling.read",
      create: "scheduling.events.create",
      update: "scheduling.events.update",
      delete: "scheduling.events.delete",
    },
    badges: {
      status: { label: "Status", labels: SCHEDULING_STATUS_LABELS },
    },
    /**
     * A agenda não tem rota por evento: o detalhe abre em painel lateral
     * dentro do Workspace. `href` leva ao Workspace.
     */
    href: () => ROUTES.scheduling,
  },
  {
    id: "artifact-execution",
    label: "Execução de artefato",
    /**
     * O plural diz de que execução se trata.
     *
     * "Execuções", sozinho, ocupava o menu ao lado de PMOC e RVT e sugeria uma
     * área genérica que reuniria as execuções dos dois — e não reúne: PMOC
     * (`PmocEquipmentExecution`) e RVT (`RvtExecution`) são modelos próprios,
     * vistos dentro do plano e da configuração. O que vive aqui é o
     * preenchimento de artefatos, que a própria tela já nomeava assim na
     * trilha de navegação.
     */
    labelPlural: "Execuções de artefato",
    description: "Preenchimento e acompanhamento de um artefato em campo.",
    /*
     * Sem `basePath` que valha como destino de menu.
     *
     * `basePath` continua apontando para a raiz porque `href(id)` a compõe —
     * e é o deep link contextual que precisa dela. O que deixou de existir é a
     * listagem global: a rota `/execucoes` redireciona para Documentos, que é
     * onde a pergunta "cadê o documento?" tem resposta.
     */
    icon: ClipboardCheck,
    color: "text-emerald-400",
    basePath: ROUTES.executions,
    capability: {
      read: "artifact_executions.read",
      manage: "artifact_executions.manage",
    },
    permissions: {
      read: "artifact_executions.read",
      create: "artifact_executions.create",
      update: "artifact_executions.update",
    },
    badges: {
      status: { label: "Status", labels: ARTIFACT_EXECUTION_STATUS_LABELS },
    },
    href: (id) => `${ROUTES.executions}/${id}`,
  },
  {
    /**
     * Orçamento — proposta comercial.
     *
     * Tem rota própria por registro, ao contrário do lançamento financeiro: um
     * orçamento é um documento com itens, histórico e desfecho, e cabe numa
     * página. Painel lateral obrigaria a rolar dentro de uma gaveta.
     *
     * `quotes.read` é **independente** de `crm.read` e `catalog.read`: ter a
     * carteira de clientes ou a tabela de preços não é o mesmo que poder propor
     * um valor em nome da empresa. É a regra que o backend aplica; aqui ela só
     * evita oferecer o que seria recusado.
     */
    id: "quote",
    label: "Orçamento",
    labelPlural: "Orçamentos",
    description:
      "Propostas comerciais: o que se ofereceu, por quanto, até quando.",
    icon: ReceiptText,
    color: "text-violet-400",
    basePath: ROUTES.quotes,
    capability: { read: "quotes.read", manage: "quotes.manage" },
    permissions: {
      read: "quotes.read",
      create: "quotes.manage",
      update: "quotes.manage",
      /** Só rascunho é apagável; enviado é cancelado, e isso é transição. */
      delete: "quotes.manage",
    },
    badges: {
      status: {
        label: "Situação",
        labels: QUOTE_STATUS_LABELS,
        classes: QUOTE_STATUS_CLASSES,
      },
    },
    href: (id) => `${ROUTES.quotes}/${id}`,
  },
  {
    /**
     * Lançamento financeiro.
     *
     * **Não tem rota própria por registro.** O detalhe abre em painel lateral
     * dentro do Workspace: um lançamento é meia dúzia de campos, e uma página
     * inteira para ele custaria uma navegação sem entregar nada. `href` leva ao
     * Workspace.
     *
     * A capability de leitura é `financial.read`, e ela é **independente** de
     * `operations.read` e `crm.read`: quem enxerga a operação ou o cliente não
     * passa a enxergar o dinheiro deles. É a mesma regra que o backend aplica —
     * aqui ela só evita oferecer o que seria recusado.
     */
    id: "financial-entry",
    label: "Lançamento",
    labelPlural: "Financeiro",
    description:
      "Entradas e saídas de dinheiro por unidade, com origem rastreável.",
    icon: Wallet,
    color: "text-emerald-400",
    basePath: ROUTES.financial,
    capability: { read: "financial.read", manage: "financial.manage" },
    permissions: {
      read: "financial.read",
      create: "financial.manage",
      update: "financial.manage",
      /**
       * Não há exclusão.
       *
       * Cancelar preserva o registro, com motivo e autor — e é `POST`, não
       * `DELETE`, no backend. Declarar uma permissão de exclusão aqui faria a
       * interface oferecer uma ação que não existe.
       */
    },
    badges: {
      type: {
        label: "Sentido",
        labels: FINANCIAL_TYPE_LABELS,
        classes: FINANCIAL_TYPE_CLASSES,
      },
      status: {
        label: "Situação",
        labels: FINANCIAL_STATUS_LABELS,
        classes: FINANCIAL_STATUS_CLASSES,
      },
      source: {
        label: "Origem",
        labels: FINANCIAL_SOURCE_LABELS,
        classes: FINANCIAL_SOURCE_CLASSES,
      },
    },
    href: () => ROUTES.financial,
  },
  {
    /**
     * Regra de automação.
     *
     * **Não tem tela própria.** Mora em Configurações → Automações, e é onde
     * ela pertence: automação é governança da organização, não um objeto do
     * dia a dia de campo. `basePath` leva às Configurações, e não há `href`
     * por registro — o detalhe abre em diálogo, porque uma regra são três
     * frases.
     *
     * A situação (`enabled`) é booleana e não vira `badges`: os mapas de
     * rótulo existem para conjuntos de status, e inventar
     * `{ true: "Ativa" }` faria um conjunto onde há um interruptor.
     */
    id: "automation-rule",
    label: "Automação",
    labelPlural: "Automações",
    description:
      "Quando algo acontece, o Orbit faz o que foi combinado: lembrete, notificação ou trabalho interno.",
    icon: Zap,
    color: "text-sky-400",
    basePath: ROUTES.settings,
    capability: { read: "automations.read", manage: "automations.manage" },
    permissions: {
      read: "automations.read",
      create: "automations.manage",
      update: "automations.manage",
      delete: "automations.manage",
    },
    badges: {},
  },
  {
    /**
     * Relatório gerencial.
     *
     * **Tem tela própria** — é o que separa esta entidade da regra de
     * automação: um relatório é aberto, lido, comparado com outro e baixado, e
     * o snapshot não cabe num diálogo.
     *
     * Não é documento do Document Center. Os dois produzem PDF, e a semelhança
     * para aí: um documento emitido pertence a uma execução de campo, tem
     * revisão e pode ser revogado; um relatório gerencial é o retrato de um
     * período, não tem revisão e se corrige gerando outro. Misturá-los faria a
     * central de documentos responder por algo que o Artifact Engine não
     * emitiu.
     *
     * A capability declarada é a **do motor**. Cada tipo exige ainda a do seu
     * domínio — `financial.read` para o financeiro —, e isso o catálogo do
     * backend publica por tipo; o registry não tem onde guardar uma exigência
     * que varia por registro.
     */
    id: "management-report",
    label: "Relatório gerencial",
    labelPlural: "Relatórios",
    description:
      "Fotografia reproduzível de um período: os números como estavam quando alguém perguntou.",
    icon: FileBarChart,
    color: "text-chart-1",
    basePath: ROUTES.managementReports,
    capability: {
      read: "reports.management.read",
      manage: "reports.management.manage",
    },
    permissions: {
      read: "reports.management.read",
      create: "reports.management.manage",
    },
    badges: {
      status: {
        label: "Situação",
        labels: REPORT_STATUS_LABELS,
        classes: REPORT_STATUS_CLASSES,
      },
    },
    href: (id) => `${ROUTES.managementReports}/${id}`,
  },
  {
    id: "artifact-template",
    label: "Modelo de documento",
    labelPlural: "Modelos de documento",
    description: "Estrutura versionada que dá origem às execuções em campo.",
    icon: LayoutTemplate,
    color: "text-amber-400",
    basePath: ROUTES.artifacts,
    capability: {
      read: "artifact_templates.read",
      manage: "artifact_templates.manage",
    },
    permissions: {
      read: "artifact_templates.read",
      create: "artifact_templates.create",
      update: "artifact_templates.update",
      delete: "artifact_templates.delete",
    },
    badges: {},
    /*
     * Sem `href`: o modelo não tem mais tela própria.
     *
     * O editor de estrutura deixou de ter porta de entrada, e o que existe é a
     * galeria de modelos. `href` ausente é previsto pelo registry — a entidade
     * aparece com nome e ícone, e sem link, em vez de levar a um endereço que
     * redireciona.
     */
  },
  {
    /**
     * Item do catálogo — produto, serviço ou peça.
     *
     * Uma entidade só, e não duas, porque o backend tem uma tabela só: `kind`
     * distingue `PRODUCT`, `SERVICE` e `PART` dentro de `products`. Registrar
     * "produto" e "serviço" como entidades separadas criaria dois donos para
     * o mesmo recurso, duas rotas para o mesmo detalhe e duas listas de ações
     * idênticas — exatamente o que o registry existe para impedir.
     *
     * O Workspace apresenta abas separadas porque quem cadastra pensa nelas
     * como coisas diferentes; o contrato continua sendo um.
     */
    id: "catalog-item",
    label: "Item do catálogo",
    labelPlural: "Produtos & Serviços",
    description:
      "Produtos, serviços e peças oferecidos pela organização — a fonte oficial de preço e descrição.",
    icon: PackageSearch,
    color: "text-teal-400",
    basePath: ROUTES.catalog,
    capability: { read: "catalog.read", manage: "catalog.manage" },
    permissions: {
      read: "catalog.read",
      create: "catalog.products.create",
      update: "catalog.products.update",
      delete: "catalog.products.delete",
    },
    badges: {
      status: {
        label: "Disponibilidade",
        labels: CATALOG_STATUS_LABELS,
        classes: CATALOG_STATUS_CLASSES,
      },
      kind: { label: "Tipo", labels: CATALOG_KIND_LABELS },
    },
    /**
     * Não há rota por item.
     *
     * O detalhe abre em painel lateral dentro do Workspace — é um cadastro
     * curto, e uma página inteira para ele seria uma navegação a mais sem
     * nada a mais. `href` leva ao Workspace.
     */
    href: () => ROUTES.catalog,
  },
  {
    /**
     * Membro da equipe.
     *
     * **Não substitui autenticação.** A entidade descreve a pessoa como
     * integrante da organização — papel, unidade, o que tem para fazer — e não
     * a conta: senha, sessão e MFA continuam em `identity/me`, administrados
     * por cada um.
     *
     * A capability de leitura é `organization.read`, a mesma de
     * `GET /organizations/current`, porque é dali que a lista de membros vem.
     */
    id: "team-member",
    label: "Membro",
    labelPlural: "Equipe",
    description:
      "Quem faz parte, com que papel e o que cada um tem para fazer.",
    icon: UsersRound,
    color: "text-indigo-400",
    basePath: ROUTES.team,
    capability: { read: "organization.read", manage: "organization.update" },
    permissions: {
      read: "organization.read",
      create: "identity.invitations.create",
    },
    badges: {
      status: {
        label: "Situação",
        labels: MEMBER_STATUS_LABELS,
        classes: MEMBER_STATUS_CLASSES,
      },
      invitation: {
        label: "Convite",
        labels: INVITATION_STATUS_LABELS,
        classes: INVITATION_STATUS_CLASSES,
      },
    },
    /**
     * Não há rota por pessoa.
     *
     * O detalhe abre em painel lateral dentro do Workspace — e não existe
     * `GET /users/:id` para um tenant: o que se sabe de alguém vem da listagem
     * de membros. `href` leva ao Workspace.
     */
    href: () => ROUTES.team,
  },
  {
    id: "customer",
    label: "Cliente",
    labelPlural: "Clientes",
    description: "Contratantes dos serviços da organização.",
    icon: Handshake,
    color: "text-fuchsia-400",
    basePath: ROUTES.customers,
    capability: { read: "crm.read", manage: "crm.manage" },
    permissions: {
      read: "customers.read",
      create: "customers.create",
      update: "customers.update",
    },
    badges: {},
    href: (id) => `${ROUTES.customers}/${id}`,
  },
];

/**
 * Índice, aviso e fallback ficam com o Registry Kernel.
 *
 * O que sobra aqui é o vocabulário de entidade — que é o que este arquivo
 * deve conter.
 */
const registry = createRegistry<EntityDefinition>({
  name: "entities",
  source: "src/entities/entity-registry.ts",
  entries: DEFINITIONS,
  derive: (id) => ({
    id: id as EntityId,
    label: id,
    labelPlural: id,
    description: "Tipo de registro ainda não descrito no Orbit.",
    icon: Boxes,
    color: "text-muted-foreground",
    basePath: "/",
    capability: { read: "", manage: "" },
    permissions: { read: "" },
    badges: {},
  }),
});

/**
 * Resolve a definição de uma entidade.
 *
 * Entidade não registrada não quebra a tela: devolve uma definição derivada do
 * próprio identificador — sempre a mesma referência — e avisa no console em
 * desenvolvimento, uma vez por id.
 */
export function resolveEntity(id: string): EntityDefinition {
  return registry.resolve(id);
}

export function getEntity(id: EntityId): EntityDefinition {
  return registry.resolve(id);
}

export const allEntities = (): readonly EntityDefinition[] => registry.all();

/**
 * Rótulo de um valor categórico da entidade.
 *
 * Valor fora do conjunto volta cru — um status novo do backend precisa
 * aparecer, não virar "Outro".
 */
export function entityBadgeLabel(
  entity: EntityId,
  group: string,
  value: string,
): string {
  return resolveEntity(entity).badges[group]?.labels[value] ?? value;
}

export function entityBadgeClass(
  entity: EntityId,
  group: string,
  value: string,
): string {
  return (
    resolveEntity(entity).badges[group]?.classes?.[value] ??
    "bg-surface-strong text-muted-foreground"
  );
}

/** Caminho do registro, ou `null` quando a entidade não tem tela própria. */
export function entityHref(entity: EntityId, id: string): string | null {
  return resolveEntity(entity).href?.(id) ?? null;
}

/**
 * Ações de entidade vivem no **Action Registry**.
 *
 * `import { getAction, actionsFor } from "@/actions";`
 *
 * Elas moravam aqui como lista inline, e a lista divergiu da realidade: uma
 * entidade ficou com `actions: []` e passou a esconder um botão que o backend
 * liberava. Um catálogo só, com um dono só.
 */
