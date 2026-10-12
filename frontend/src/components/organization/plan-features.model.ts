/**
 * O que o plano habilita, dito como recurso e não como capability.
 *
 * ## O que havia
 *
 * A seção listava `artifact_manifests.read`, `scheduling.intelligence` e outras
 * sessenta chaves em `<code>`, cada uma com os planos que a concedem. É o
 * vocabulário dos decorators `@Capabilities(...)` do backend — correto, e
 * ilegível para quem está decidindo se precisa mudar de plano.
 *
 * ## Como fica legível sem inventar documentação
 *
 * A chave é `<módulo>.<operação>`, convenção visível nos próprios controllers.
 * O módulo tem nome de produto ("Estoque", "PMOC"); a operação tem nome de
 * verbo ("consultar", "gerenciar"). Duas tabelas pequenas de tradução, uma
 * linha por módulo, e a chave crua sai da tela.
 *
 * Uma chave nova de um módulo desconhecido não desaparece: cai em `humanizeId`
 * e aparece com o nome cru, que é como se descobre que falta traduzir.
 *
 * ## De onde sai "existe no produto"
 *
 * O backend não publica catálogo de capabilities. Publica `GET /plans`, cada
 * plano com a sua lista; a **união** das listas é o que existe, e os planos que
 * concedem uma capability são a resposta para "onde eu consigo isso".
 */
import { humanizeId } from "@/registry";

/** Nome de produto de cada módulo. O prefixo da capability é a chave. */
const MODULE_LABELS: Readonly<Record<string, string>> = {
  ai: "Inteligência artificial",
  analytics: "Análises",
  artifact_executions: "Execuções de documento",
  artifact_manifests: "Documentos emitidos",
  artifact_rendering: "Emissão de documentos",
  artifact_templates: "Modelos de documento",
  assets: "Equipamentos",
  automations: "Automações",
  business_units: "Organizações",
  catalog: "Catálogo",
  checklists: "Checklists",
  crm: "Clientes",
  customer_service_requests: "Solicitações de clientes",
  dashboard: "Painel",
  document_engine: "Motor de documentos",
  financial: "Financeiro",
  integrations: "Integrações",
  inventory: "Estoque",
  notifications: "Notificações",
  /* "Operações" é a palavra que o menu e o workspace usam; chamar de
     "Atendimentos" só aqui daria dois nomes para a mesma coisa. */
  operations: "Operações",
  pmoc: "PMOC",
  quotes: "Orçamentos",
  reports: "Relatórios",
  rvt: "RVT",
  scheduling: "Agenda",
  signatures: "Assinaturas",
  workforce: "Equipe",
};

/** Verbo de cada operação, pela parte da chave depois do módulo. */
const OPERATION_LABELS: Readonly<Record<string, string>> = {
  document: "emitir documento",
  execute: "executar",
  "executions.read": "consultar execuções",
  "executions.run": "executar",
  "agents.manage": "configurar agentes",
  "agents.read": "consultar agentes",
  intelligence: "otimizar automaticamente",
  manage: "gerenciar",
  "management.manage": "gerenciar",
  "management.read": "consultar",
  "qr.manage": "gerenciar etiquetas QR",
  read: "consultar",
  render: "emitir",
  run: "executar",
};

export interface PlanFeature {
  /** Prefixo da capability — chave de lista, não texto de tela. */
  readonly id: string;
  readonly name: string;
  /** Operações que o plano atual habilita, já em português. */
  readonly included: readonly string[];
  /** Operações que existem no produto e este plano não habilita. */
  readonly missing: readonly string[];
  /** Planos que habilitam o que falta, pelo nome comercial. */
  readonly availableIn: readonly string[];
}

/** Uma capability, partida em módulo e operação. */
function split(key: string): { module: string; operation: string } {
  const dot = key.indexOf(".");
  if (dot < 0) return { module: key, operation: "read" };
  return { module: key.slice(0, dot), operation: key.slice(dot + 1) };
}

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? humanizeId(module);
}

export function operationLabel(operation: string): string {
  return OPERATION_LABELS[operation] ?? humanizeId(operation).toLowerCase();
}

export interface PlanLike {
  readonly key: string;
  readonly name: string;
  readonly capabilities: readonly string[];
}

/**
 * Um recurso por módulo, em ordem alfabética do nome exibido.
 *
 * `enabled` são as capabilities da organização — inclui as que nenhum plano do
 * catálogo lista, que existem quando alguém concedeu à mão.
 */
export function buildPlanFeatures(
  plans: readonly PlanLike[],
  enabled: readonly string[],
): PlanFeature[] {
  const enabledSet = new Set(enabled);

  /** capability → planos que a concedem, pelo nome comercial. */
  const grantedBy = new Map<string, string[]>();
  for (const plan of plans) {
    for (const capability of plan.capabilities) {
      grantedBy.set(capability, [
        ...(grantedBy.get(capability) ?? []),
        /* O nome comercial, não `plan.key`: ninguém chama o plano de
           `PROFESSIONAL_INTELLIGENCE`, nem no contrato nem na conversa. */
        plan.name || plan.key,
      ]);
    }
  }
  for (const capability of enabled) {
    if (!grantedBy.has(capability)) grantedBy.set(capability, []);
  }

  const byModule = new Map<
    string,
    {
      included: Set<string>;
      /** verbo em falta → planos que o concedem. */
      missing: Map<string, Set<string>>;
    }
  >();

  for (const [key, plansGranting] of grantedBy) {
    const { module, operation } = split(key);
    const row = byModule.get(module) ?? {
      included: new Set<string>(),
      missing: new Map<string, Set<string>>(),
    };

    const verbo = operationLabel(operation);
    if (enabledSet.has(key)) row.included.add(verbo);
    else {
      const planos = row.missing.get(verbo) ?? new Set<string>();
      for (const plan of plansGranting) planos.add(plan);
      row.missing.set(verbo, planos);
    }

    byModule.set(module, row);
  }

  return [...byModule.entries()]
    .map(([module, row]) => {
      /* Duas capabilities do mesmo módulo traduzem para o mesmo verbo
         (`reports.read` e `reports.management.read` são ambas "consultar").
         Quando uma está habilitada e a outra não, o módulo diria que permite e
         não permite consultar ao mesmo tempo — quem está habilitado ganha, e os
         planos daquela metade que falta saem junto: não se sobe de plano para
         ganhar o que já se tem. */
      const ordenar = (valores: Iterable<string>) =>
        [...valores].sort((a, b) => a.localeCompare(b, "pt-BR"));

      const faltando = [...row.missing].filter(
        ([verbo]) => !row.included.has(verbo),
      );

      return {
        id: module,
        name: moduleLabel(module),
        included: ordenar(row.included),
        missing: ordenar(faltando.map(([verbo]) => verbo)),
        availableIn: ordenar(
          new Set(faltando.flatMap(([, planos]) => [...planos])),
        ),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));
}
