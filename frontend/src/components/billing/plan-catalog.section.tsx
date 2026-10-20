"use client";

/**
 * Os planos disponíveis.
 *
 * Quatro cartões e um seletor de periodicidade. Os preços vêm do catálogo do
 * servidor — o cliente não multiplica, não aplica desconto e não conhece
 * identificador de preço de provedor nenhum.
 *
 * O botão de cada cartão sai de `allowedActions`. Não há `if (plano === X)`
 * decidindo o que a pessoa pode fazer: se o servidor não autorizou a ação, ela
 * não aparece.
 */
import { useState } from "react";
import { Check, Sparkles } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  BILLING_INTERVALS,
  BILLING_INTERVAL_LABELS,
  type BillingOverview,
  type PlanCatalogEntry,
} from "@/types/billing";
import { derivarAcoes } from "./billing-actions";
import { equivalenteMensal, formatCentavos, formatLimite } from "./billing-format";

/** Os limites que cabem num cartão. A lista completa fica no bloco de uso. */
const DESTAQUES = [
  "PLATFORM_USERS",
  "FIELD_TECHNICIANS",
  "BUSINESS_UNITS",
  "ACTIVE_CUSTOMERS",
  "ACTIVE_EQUIPMENT",
] as const;

const DESTAQUES_DE_USO = ["SERVICE_ORDERS_CREATED"] as const;

const ROTULOS_CURTOS: Readonly<Record<string, string>> = {
  PLATFORM_USERS: "Usuários",
  FIELD_TECHNICIANS: "Equipe de campo",
  BUSINESS_UNITS: "Unidades",
  ACTIVE_CUSTOMERS: "Clientes",
  ACTIVE_EQUIPMENT: "Equipamentos",
  SERVICE_ORDERS_CREATED: "Ordens de serviço por mês",
};

/** A capacidade que separa os planos com inteligência. */
const CAPACIDADE_DE_INTELIGENCIA = "ORBIT_INTELLIGENCE";

interface Props {
  overview: BillingOverview;
  onSubscribe: (planCode: string, interval: string) => void;
  onChangePlan: (planCode: string, interval: string) => void;
  pending: boolean;
}

export function PlanCatalogSection({
  overview,
  onSubscribe,
  onChangePlan,
  pending,
}: Props) {
  const { subscription, catalog, billing, entitlements } = overview;

  /**
   * Qual plano está em vigor **agora**.
   *
   * Não é só o da assinatura de cobrança: uma organização em avaliação, ou com
   * plano concedido, tem plano em vigor e nenhuma assinatura — e nesse caso os
   * quatro cartões apareciam com o mesmo peso, sem dizer em qual ela está.
   * `entitlements.planCode` é a autoridade sobre o que vale hoje.
   */
  const planoVigente = subscription?.planCode ?? entitlements.planCode;

  /**
   * A ordem do catálogo é a ordem de preço, do menor para o maior.
   *
   * É o que permite dizer "acima do seu" sem comparar preço no cliente — e
   * comparar preço aqui erraria assim que existir plano com desconto anual.
   */
  const posicaoVigente = catalog.plans.findIndex(
    (plano) => plano.code === planoVigente,
  );

  /**
   * A periodicidade começa na que a empresa já contratou.
   *
   * Quem assina anual abre a página e vê o próprio preço, não o mensal — a
   * comparação começa de onde a pessoa está.
   */
  const [intervalo, setIntervalo] = useState<string>(
    subscription?.billingInterval ?? "MONTHLY",
  );

  const acoes = derivarAcoes(overview);

  return (
    <PanelFrame
      panelId="billing-catalog"
      title="Planos"
      description="Escolha a periodicidade e compare o que cada plano inclui"
      actions={
        <Tabs value={intervalo} onValueChange={setIntervalo}>
          <TabsList aria-label="Periodicidade da cobrança">
            {BILLING_INTERVALS.map((codigo) => (
              <TabsTrigger key={codigo} value={codigo}>
                {BILLING_INTERVAL_LABELS[codigo]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    >
      {!billing.configured ? (
        <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          A contratação online ainda não está disponível. Fale com o time
          comercial para assinar ou mudar de plano.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {catalog.plans.map((plano, indice) => (
          <PlanCard
            key={plano.code}
            plano={plano}
            intervalo={intervalo}
            atual={plano.code === planoVigente}
            posicao={
              posicaoVigente < 0
                ? "indefinida"
                : indice > posicaoVigente
                  ? "acima"
                  : indice < posicaoVigente
                    ? "abaixo"
                    : "atual"
            }
            podeContratar={acoes.canSubscribe}
            podeTrocar={acoes.canChangePlan}
            temAssinatura={subscription !== null}
            pending={pending}
            onSubscribe={() => onSubscribe(plano.code, intervalo)}
            onChangePlan={() => onChangePlan(plano.code, intervalo)}
          />
        ))}
      </div>
    </PanelFrame>
  );
}

function PlanCard({
  plano,
  intervalo,
  atual,
  posicao,
  podeContratar,
  podeTrocar,
  temAssinatura,
  pending,
  onSubscribe,
  onChangePlan,
}: {
  plano: PlanCatalogEntry;
  intervalo: string;
  atual: boolean;
  /** Onde este plano está em relação ao vigente. */
  posicao: "atual" | "acima" | "abaixo" | "indefinida";
  podeContratar: boolean;
  podeTrocar: boolean;
  temAssinatura: boolean;
  pending: boolean;
  onSubscribe: () => void;
  onChangePlan: () => void;
}) {
  const preco = plano.prices[intervalo];
  const equivalente = preco
    ? equivalenteMensal(preco.amountMinor, intervalo)
    : null;
  const temInteligencia = plano.capabilities.includes(
    CAPACIDADE_DE_INTELIGENCIA,
  );

  return (
    <article
      className={cn(
        "flex flex-col gap-4 rounded-lg border border-border p-4",
        /* O vigente ganha moldura e anel: num painel de quatro cartões iguais,
           a borda sozinha não chama o olho o bastante. */
        atual && "border-primary bg-primary/5 ring-1 ring-primary/30",
      )}
      aria-label={plano.label}
    >
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display text-base font-semibold">{plano.label}</h3>
          {atual ? (
            <Badge variant="secondary">Seu plano</Badge>
          ) : posicao === "acima" ? (
            /* Para onde dá para migrar — a pergunta que traz alguém a esta
               tela é "o que eu ganho pagando mais", e ela não tinha resposta
               visível. */
            <Badge variant="outline" className="gap-1">
              <ArrowUpRight className="size-3" aria-hidden />
              Acima do seu
            </Badge>
          ) : null}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {plano.description}
        </p>
      </header>

      <div>
        {preco ? (
          <>
            <p className="font-display text-xl font-bold tabular-nums">
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
            Preço não publicado para esta periodicidade.
          </p>
        )}
      </div>

      <ul className="space-y-1.5 text-sm">
        {DESTAQUES.map((recurso) => (
          <li key={recurso} className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">
              {ROTULOS_CURTOS[recurso]}
            </span>
            <span className="tabular-nums">
              {plano.allocation[recurso]
                ? formatLimite(plano.allocation[recurso]!)
                : "—"}
            </span>
          </li>
        ))}
        {DESTAQUES_DE_USO.map((recurso) => (
          <li key={recurso} className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground">
              {ROTULOS_CURTOS[recurso]}
            </span>
            <span className="tabular-nums">
              {plano.usage[recurso] ? formatLimite(plano.usage[recurso]!) : "—"}
            </span>
          </li>
        ))}
      </ul>

      <p className="flex items-center gap-2 text-xs">
        {temInteligencia ? (
          <>
            <Sparkles className="size-3.5 text-primary" aria-hidden />
            <span>Orbit Intelligence incluído</span>
          </>
        ) : (
          <>
            <Check className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="text-muted-foreground">
              Operação completa, sem a camada de inteligência
            </span>
          </>
        )}
      </p>

      <div className="mt-auto pt-1">
        {atual ? (
          <Button variant="outline" size="sm" className="w-full" disabled>
            Plano atual
          </Button>
        ) : temAssinatura ? (
          podeTrocar ? (
            <Button
              size="sm"
              className="w-full"
              onClick={onChangePlan}
              disabled={pending}
            >
              {posicao === "acima" ? "Migrar para este" : "Mudar para este"}
            </Button>
          ) : null
        ) : podeContratar ? (
          <Button
            size="sm"
            className="w-full"
            onClick={onSubscribe}
            disabled={pending}
          >
            Assinar
          </Button>
        ) : null}
      </div>
    </article>
  );
}
