"use client";

/**
 * A vitrine dos planos.
 *
 * ## O que este arquivo é
 *
 * Apresentação pura de um catálogo que chegou pronto. Ele troca a
 * periodicidade exibida e nada mais: não conhece assinatura, não conhece
 * sessão e não importa nenhum hook que exija login. É essa fronteira que
 * garante que a página pública continue pública.
 *
 * ## O que ele não faz
 *
 * Não calcula preço — o equivalente mensal é uma divisão do valor publicado,
 * mostrada **ao lado** do total, e o total continua sendo o que se paga. Não
 * decide quem tem direito à avaliação gratuita: anuncia a regra do plano, e a
 * decisão individual acontece na contratação, no servidor.
 *
 * O botão nunca assina nada. Contratar exige organização autenticada, então o
 * caminho público é o cadastro — oferecer um checkout aqui seria prometer um
 * fluxo que não existe.
 */
import { useState } from "react";
import Link from "next/link";
import { Check, Minus, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  equivalenteMensal,
  formatCentavos,
  formatLimite,
} from "@/components/billing/billing-format";
import { cn } from "@/lib/utils";
import { ROUTES } from "@/lib/routes";
import {
  BILLING_INTERVALS,
  BILLING_INTERVAL_LABELS,
  ENTITLEMENT_RESOURCE_LABELS,
  HIDDEN_ENTITLEMENT_RESOURCES,
  type PlanCatalog,
  type PlanCatalogEntry,
} from "@/types/billing";
import {
  TRIAL_DAYS,
  ofereceAvaliacao,
  ordenarPlanos,
  temInteligencia,
} from "./pricing-catalog";

/**
 * Para quem cada plano foi desenhado.
 *
 * É posicionamento comercial, e por isso vive na apresentação — não é regra,
 * não decide acesso e o backend não tem opinião sobre isso. O `description` do
 * catálogo já diz o que o plano é; esta linha diz para quem ele serve.
 */
const PUBLICO: Readonly<Record<string, string>> = {
  ESSENTIAL: "Para quem está organizando o campo pela primeira vez",
  PROFESSIONAL: "Para operações com mais de uma unidade e equipe crescendo",
  PROFESSIONAL_INTELLIGENCE:
    "Para quem quer a operação assistida pela inteligência do Orbit",
  ENTERPRISE_UNLIMITED: "Para operações grandes, sem teto de volume",
};

/** Os limites que cabem num cartão. A tabela abaixo mostra todos. */
const DESTAQUES = [
  "BUSINESS_UNITS",
  "PLATFORM_USERS",
  "FIELD_TECHNICIANS",
  "ACTIVE_CUSTOMERS",
  "ACTIVE_EQUIPMENT",
  "SERVICE_ORDERS_CREATED",
] as const;

/** A ordem em que os limites aparecem na comparação. */
const ORDEM_DOS_LIMITES = [
  "BUSINESS_UNITS",
  "PLATFORM_USERS",
  "FIELD_TECHNICIANS",
  "AUXILIARY_TECHNICIANS",
  "ACTIVE_CUSTOMERS",
  "ACTIVE_EQUIPMENT",
  "SERVICE_ORDERS_CREATED",
  "PMOC_DOCUMENTS_ISSUED",
  "RVT_DOCUMENTS_ISSUED",
  "OTHER_DOCUMENTS_ISSUED",
  "AUTOMATION_RUNS",
] as const;

/** As capacidades comparadas, com o nome que a pessoa reconhece. */
const CAPACIDADES: readonly { code: string; label: string }[] = [
  { code: "CUSTOMERS", label: "Clientes e equipamentos" },
  { code: "OPERATIONS", label: "Ordens de serviço" },
  { code: "FIELD_OPERATIONS", label: "Aplicativo de campo" },
  { code: "PMOC", label: "PMOC" },
  { code: "RVT", label: "Relatório de visita técnica" },
  { code: "ARTIFACTS", label: "Documentos e modelos" },
  { code: "AUTOMATIONS", label: "Automações" },
  { code: "ANALYTICS", label: "Indicadores" },
  { code: "INTEGRATIONS", label: "Integrações" },
  { code: "ORBIT_INTELLIGENCE", label: "Orbit Intelligence" },
  { code: "AI_ASSISTANTS", label: "Agentes auxiliares" },
];

export function PricingPlans({
  catalog,
  variant = "full",
}: {
  catalog: PlanCatalog;
  /** `resumo` é o recorte da landing: cartões e CTA, sem tabela. */
  variant?: "full" | "resumo";
}) {
  const [intervalo, setIntervalo] = useState<string>("MONTHLY");
  const planos = ordenarPlanos(catalog.plans);

  return (
    <div className="space-y-8">
      <div className="flex justify-center">
        <Tabs value={intervalo} onValueChange={setIntervalo}>
          <TabsList aria-label="Periodicidade da cobrança">
            {BILLING_INTERVALS.map((codigo) => (
              <TabsTrigger key={codigo} value={codigo}>
                {BILLING_INTERVAL_LABELS[codigo]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {planos.map((plano) => (
          <PublicPlanCard
            key={plano.code}
            plano={plano}
            intervalo={intervalo}
          />
        ))}
      </div>

      {variant === "resumo" ? (
        <div className="flex justify-center">
          <Button asChild variant="outline" size="lg">
            <Link href={ROUTES.plans}>Ver todos os planos</Link>
          </Button>
        </div>
      ) : (
        <>
          <LimitsTable planos={planos} />
          <CapabilitiesTable planos={planos} />
        </>
      )}
    </div>
  );
}

function PublicPlanCard({
  plano,
  intervalo,
}: {
  plano: PlanCatalogEntry;
  intervalo: string;
}) {
  const preco = plano.prices[intervalo];
  const equivalente = preco
    ? equivalenteMensal(preco.amountMinor, intervalo)
    : null;
  const inteligencia = temInteligencia(plano);

  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-border bg-card p-5",
        inteligencia && "border-primary/40",
      )}
      aria-label={plano.label}
    >
      <header className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base font-semibold text-foreground">
            {plano.label}
          </h3>
          {inteligencia ? (
            <Badge variant="secondary" className="gap-1 whitespace-nowrap">
              <Sparkles className="size-3" aria-hidden />
              Inteligência
            </Badge>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {PUBLICO[plano.code] ?? plano.description}
        </p>
      </header>

      <div>
        {preco ? (
          <>
            <p className="font-display text-2xl font-bold tabular-nums text-foreground">
              {formatCentavos(preco.amountMinor)}
            </p>
            <p className="text-xs text-muted-foreground">
              {equivalente
                ? `${equivalente} por mês · cobrado por período`
                : "por mês"}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Preço sob consulta nesta periodicidade
          </p>
        )}
      </div>

      {ofereceAvaliacao(plano) ? (
        <p className="rounded-md bg-success/10 px-3 py-2 text-xs text-success">
          {TRIAL_DAYS} dias grátis na primeira contratação elegível
        </p>
      ) : null}

      <ul className="flex-1 space-y-1.5">
        {DESTAQUES.map((recurso) => {
          const limite =
            plano.allocation[recurso] ?? plano.usage[recurso] ?? null;
          if (!limite) return null;
          return (
            <li
              key={recurso}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="text-muted-foreground">
                {ENTITLEMENT_RESOURCE_LABELS[recurso] ?? recurso}
              </span>
              <span className="tabular-nums font-medium text-foreground">
                {formatLimite(limite)}
              </span>
            </li>
          );
        })}
      </ul>

      {/*
        O botão leva ao cadastro, nunca a um checkout.

        Contratar exige uma organização autenticada — o caminho é cadastro,
        criação da empresa e só então a escolha do plano. Um "assinar" aqui
        prometeria um atalho que o produto não tem.
      */}
      <Button asChild className="w-full">
        <Link href={`${ROUTES.register}?plano=${plano.code}`}>
          {ofereceAvaliacao(plano) ? "Testar grátis" : "Começar agora"}
        </Link>
      </Button>
    </article>
  );
}

function LimitsTable({ planos }: { planos: readonly PlanCatalogEntry[] }) {
  const linhas = ORDEM_DOS_LIMITES.filter(
    (recurso) => !HIDDEN_ENTITLEMENT_RESOURCES.has(recurso),
  );

  return (
    <ComparisonTable
      caption="Limites por plano"
      description="Cotas de uso são mensais em qualquer periodicidade de cobrança — assinar por ano não adianta doze meses de uso de uma vez."
      planos={planos}
      linhas={linhas.map((recurso) => ({
        key: recurso,
        label: ENTITLEMENT_RESOURCE_LABELS[recurso] ?? recurso,
        valor: (plano) => {
          const limite =
            plano.allocation[recurso] ?? plano.usage[recurso] ?? null;
          return limite ? formatLimite(limite) : "—";
        },
      }))}
    />
  );
}

function CapabilitiesTable({
  planos,
}: {
  planos: readonly PlanCatalogEntry[];
}) {
  return (
    <ComparisonTable
      caption="Funcionalidades por plano"
      planos={planos}
      linhas={CAPACIDADES.map((capacidade) => ({
        key: capacidade.code,
        label: capacidade.label,
        valor: (plano) =>
          plano.capabilities.includes(capacidade.code) ? "incluído" : "ausente",
      }))}
    />
  );
}

/**
 * A comparação.
 *
 * ## Duas formas, escolhidas pela largura
 *
 * No celular, **uma lista por plano**. Quatro colunas não cabem em 375 pixels,
 * e a tabela que rolava de lado empurrava a página inteira junto — a leitura
 * virava um exercício de arrastar para descobrir de que plano era aquela
 * coluna. Empilhado, cada plano é lido inteiro sem sair do lugar.
 *
 * A partir de `md`, a tabela — que é onde ela ganha: comparar quatro planos
 * lado a lado é exatamente o que uma tabela faz melhor do que qualquer lista.
 */
function ComparisonTable({
  caption,
  description,
  planos,
  linhas,
}: {
  caption: string;
  description?: string;
  planos: readonly PlanCatalogEntry[];
  linhas: readonly {
    key: string;
    label: string;
    valor: (plano: PlanCatalogEntry) => string;
  }[];
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-display text-lg font-semibold text-foreground">
          {caption}
        </h3>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>

      {/* Celular: um bloco por plano. */}
      <div className="space-y-4 md:hidden">
        {planos.map((plano) => (
          <div
            key={plano.code}
            className="rounded-xl border border-border bg-card p-4"
          >
            <h4 className="text-sm font-semibold text-foreground">
              {plano.label}
            </h4>
            <dl className="mt-3 space-y-2">
              {linhas.map((linha) => (
                <div
                  key={linha.key}
                  className="flex items-baseline justify-between gap-3 text-sm"
                >
                  <dt className="text-muted-foreground">{linha.label}</dt>
                  <dd className="tabular-nums text-foreground">
                    <Marca valor={linha.valor(plano)} />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      {/* Telas largas: a tabela. */}
      <div className="hidden rounded-xl border border-border md:block">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th scope="col" className="px-4 py-3 text-left font-medium">
                Recurso
              </th>
              {planos.map((plano) => (
                <th
                  key={plano.code}
                  scope="col"
                  className="px-4 py-3 text-left font-medium"
                >
                  {plano.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr
                key={linha.key}
                className="border-b border-border last:border-0"
              >
                <th
                  scope="row"
                  className="px-4 py-2.5 text-left font-normal text-muted-foreground"
                >
                  {linha.label}
                </th>
                {planos.map((plano) => (
                  <td key={plano.code} className="px-4 py-2.5 tabular-nums">
                    <Marca valor={linha.valor(plano)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Incluído, ausente, ou o número.
 *
 * O ícone vem com texto para leitor de tela: um visto sozinho não diz nada a
 * quem não o vê, e "incluído"/"não incluído" é o que a coluna significa.
 */
function Marca({ valor }: { valor: string }) {
  if (valor === "incluído") {
    return (
      <>
        <Check className="size-4 text-success" aria-hidden />
        <span className="sr-only">Incluído</span>
      </>
    );
  }
  if (valor === "ausente") {
    return (
      <>
        <Minus className="size-4 text-muted-foreground/60" aria-hidden />
        <span className="sr-only">Não incluído</span>
      </>
    );
  }
  return <>{valor}</>;
}
