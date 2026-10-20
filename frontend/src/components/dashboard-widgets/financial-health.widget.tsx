"use client";

/**
 * Saúde Financeira — `GET /financial/analytics/summary` e `/timeline`.
 *
 * Substitui o painel que declarava a ausência do domínio financeiro. A
 * declaração estava certa até a PR-21 do backend: não havia modelo nem
 * endpoint, e o painel dizia isso em vez de estimar. Agora há.
 *
 * ## Por que este widget busca os próprios dados
 *
 * O Dashboard faz as leituras compartilhadas em `dashboard-view` e as
 * distribui — a regra existe para que dez widgets não repitam a mesma
 * consulta. Aqui há **um** consumidor, e a leitura é privilegiada: quem não
 * tem `financial.read` receberia 403 em toda abertura do Dashboard se a
 * consulta subisse para o nível compartilhado. O widget consulta se, e só se,
 * a sessão o permitir.
 *
 * ## Realizado e previsto continuam separados
 *
 * O card compacto mostra saldo, receitas e despesas **realizados**, e o
 * previsto aparece à parte, rotulado. Um "saldo" que somasse os dois pareceria
 * caixa e não seria — a mesma regra da Visão Geral do Workspace.
 *
 * ## Período e unidade são os do Dashboard — com uma exceção dita
 *
 * `analytics.query` é o mesmo recorte que alimenta os demais painéis, e os números
 * do cartão são dele. O Financeiro não inventa um seletor paralelo.
 *
 * A **linha** é a exceção: a série do servidor é mensal, e trinta dias dão um mês.
 * Ela pede doze meses terminando no fim do recorte — a evolução precisa de história,
 * e a do período escolhido não existe. Terminar junto com o recorte é o que mantém a
 * linha e os números falando do mesmo instante.
 */
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Button } from "@/components/ui/button";
import {
  useFinancialSummary,
  useFinancialTimeline,
} from "@/hooks/financial/use-financial";
import { useSession } from "@/providers/session-provider";
import { ROUTES } from "@/lib/routes";
import { FORMATTERS, resolveMetric } from "@/metrics";
import type { FinancialAnalyticsQuery } from "@/types/financial";
import { formatMonth } from "@/components/financial/financial-presentation";
import {
  deveDesenharEvolucao,
  deveMarcarPontos,
  historyWindow,
} from "./financial-history";
import type { WidgetProps } from "./widget-registry";

/** `2026-08-09T00:00:00.000Z` → `2026-08-09`. */
const toDay = (iso: string | undefined): string | undefined =>
  iso?.slice(0, 10);

export function FinancialHealthWidget({ widget, analytics }: WidgetProps) {
  const session = useSession();
  const allowed = session.hasCapability("financial.read");

  const query: FinancialAnalyticsQuery = {
    from: toDay(analytics.query.from),
    to: toDay(analytics.query.to),
    businessUnitId: analytics.query.businessUnitId,
  };

  /**
   * `enabled` mora no hook do TanStack Query.
   *
   * Chamar os hooks sempre e desligar a consulta é o que mantém a ordem dos
   * hooks estável — condicionar a chamada quebraria as regras do React na
   * primeira vez que a capability mudasse.
   */
  const summary = useFinancialSummary(allowed ? query : undefined);

  /**
   * A linha tem janela própria, e é por isso que ela existe.
   *
   * A série é **mensal** e o painel abre em trinta dias: a consulta devolvia um
   * ponto, e um gráfico de linha com um ponto não desenha nada — o gráfico
   * simplesmente não aparecia. Os números acima continuam sendo os do período
   * escolhido; quem olha para trás é a linha, porque é ela que responde "como
   * chegamos até aqui".
   */
  const timeline = useFinancialTimeline(
    allowed
      ? { ...historyWindow(query.to), businessUnitId: query.businessUnitId }
      : undefined,
  );

  if (!allowed) {
    return (
      <PanelFrame
        panelId={widget.id}
        title={widget.title}
        description={widget.description}
      >
        <p className="text-sm text-muted-foreground">
          Seu acesso não inclui o módulo financeiro. Ele é concedido
          separadamente de operações e clientes.
        </p>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      panelId={widget.id}
      title={widget.title}
      description={widget.description}
      actions={
        <Button asChild size="sm" variant="ghost">
          <Link href={ROUTES.financial}>
            Abrir
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      }
    >
      <PanelState query={toPanelQuery(summary)} loadingRows={3}>
        {(data) => (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Figure id="financial.netConfirmed" value={data.netConfirmed} />
              <Figure
                id="financial.income.confirmed"
                value={data.income.confirmed}
              />
              <Figure
                id="financial.expense.confirmed"
                value={data.expense.confirmed}
              />
            </div>

            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="text-xs text-muted-foreground">
                Previsto no período
              </span>
              <span className="flex flex-wrap items-baseline gap-3">
                <Inline
                  label="receitas"
                  value={data.income.pending}
                  tone="text-amber-400"
                />
                <Inline
                  label="despesas"
                  value={data.expense.pending}
                  tone="text-amber-400"
                />
                {Number(data.overdue.pending) > 0 ? (
                  <Inline
                    label="vencido"
                    value={data.overdue.pending}
                    tone="text-rose-400"
                  />
                ) : null}
              </span>
            </div>

            <TimelineChart query={timeline} />

            <p className="text-xs text-muted-foreground">
              {data.period.from} a {data.period.to} · valores em {data.currency}
              . Totais consolidados do período.
            </p>
          </div>
        )}
      </PanelState>
    </PanelFrame>
  );
}

/** Um número, com rótulo e cor vindos do Metric Registry. */
function Figure({ id, value }: { id: string; value: string }) {
  const metric = resolveMetric({ id });
  const amount = Number(value);

  return (
    <div className="space-y-0.5">
      <p className="truncate text-xs text-muted-foreground">{metric.label}</p>
      <p
        className={`font-display text-lg font-bold tabular-nums ${metric.color}`}
      >
        {Number.isFinite(amount) ? FORMATTERS.currency(amount) : value}
      </p>
    </div>
  );
}

function Inline({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  const amount = Number(value);
  return (
    <span className="text-xs">
      <span className="text-muted-foreground">{label} </span>
      <span className={`font-mono tabular-nums ${tone}`}>
        {Number.isFinite(amount) ? FORMATTERS.currency(amount) : value}
      </span>
    </span>
  );
}

/**
 * A evolução, com hoje como referência.
 *
 * ## O que esta faixa era, e por que mudou
 *
 * Era uma linha só — o saldo realizado — de 96 pixels, sem eixo e sem legenda. Ela
 * dizia a direção e mais nada: não dava para ver **de onde** o saldo veio (receita
 * alta ou despesa baixa?) nem onde o mês corrente está na série. O painel mostrava
 * três números do período e uma curva que não os explicava.
 *
 * ## As três séries, uma escala
 *
 * Receita, despesa e saldo são a mesma unidade — reais — e por isso dividem um eixo
 * só. Dois eixos seriam a forma mais rápida de fazer duas curvas se cruzarem por
 * acidente de escala e alguém concluir que a despesa passou a receita.
 *
 * As cores são **as mesmas** que o Workspace do Financeiro atribuiu a cada série:
 * receita, despesa e saldo não trocam de cor ao mudar de tela. A cor segue a
 * entidade, não a posição na lista.
 *
 * ## Hoje é a referência, e aparece como linha
 *
 * A série é mensal e vai além do mês corrente quando o recorte inclui o futuro. Sem
 * marca, o último ponto parece o presente — e um mês que ainda não terminou lido
 * como fechado faz a queda do fim do gráfico parecer prejuízo. A linha pontilhada
 * diz onde estamos; o que está à direita dela ainda não aconteceu.
 */
function TimelineChart({
  query,
}: {
  query: ReturnType<typeof useFinancialTimeline>;
}) {
  const points = (query.data ?? []).map((point) => ({
    month: point.month,
    label: formatMonth(point.month),
    incomeConfirmed: Number(point.incomeConfirmed),
    expenseConfirmed: Number(point.expenseConfirmed),
    netConfirmed: Number(point.netConfirmed),
  }));

  /*
   * Sem nenhum ponto não há o que desenhar.
   *
   * Acontece numa organização que ainda não lançou nada: a janela pede doze meses e
   * nenhum tem movimento. Aí a frase diz o que falta, que é movimento.
   *
   * Com **um** ponto o gráfico aparece. Antes o corte era em dois, e era por isso
   * que o gráfico "continuava não aparecendo" para quem tem um mês de uso: uma
   * linha de um ponto não desenha traço, mas desenha o ponto — e eixo, grade e
   * escala já respondem "onde estamos", que é metade do que o painel promete.
   * Recusar a desenhar transformava uma organização nova numa tela sem gráfico.
   */
  if (!deveDesenharEvolucao(points.length)) {
    return (
      <p className="text-muted-foreground text-xs">
        A evolução aparece quando houver movimento financeiro registrado.
      </p>
    );
  }

  /*
   * Com poucos pontos, o ponto é a marca.
   *
   * `dot={false}` é certo numa série de doze meses, onde doze marcas por linha
   * viram ruído. Com um ou dois pontos é o contrário: sem marca, um ponto único não
   * pinta pixel nenhum e o cartão mostra eixos vazios — exatamente o sintoma de
   * "não tem gráfico".
   */
  const marcarPontos = deveMarcarPontos(points.length);

  /* O mês de hoje, no formato da série. `sv-SE` dá `YYYY-MM-DD` sem depender de
     montar a data à mão com `padStart`. */
  const hoje = new Date().toLocaleDateString("sv-SE").slice(0, 7);
  const mesCorrente = points.find((point) => point.month === hoje);

  return (
    <div className="space-y-2">
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={points}
            margin={{ top: 4, right: 8, bottom: 0, left: 0 }}
          >
            {/* Grade recessiva e só horizontal: a leitura é de valor, não de
                data — linhas verticais competiriam com as curvas. */}
            <CartesianGrid
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={56}
              /* Compacto no eixo, completo na dica: `R$ 1.234.567,00` repetido em
                 cinco marcas não cabe num cartão de painel, e o número exato é o
                 que o cursor responde. */
              tickFormatter={(value: number) => compacto.format(value)}
            />
            <Tooltip
              formatter={(value: number) => FORMATTERS.currency(value)}
              labelFormatter={(label: string) => label}
              contentStyle={{
                background: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.5rem",
              }}
            />
            {/* Três séries pedem legenda: identidade nunca pode depender só da
                cor. */}
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            />

            {mesCorrente ? (
              <ReferenceLine
                x={mesCorrente.label}
                stroke="var(--color-muted-foreground)"
                strokeDasharray="2 4"
                label={{
                  value: "hoje",
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "var(--color-muted-foreground)",
                }}
              />
            ) : null}

            <Line
              type="monotone"
              dataKey="incomeConfirmed"
              name="Receita"
              stroke="var(--color-chart-2)"
              strokeWidth={2}
              dot={marcarPontos ? { r: 3 } : false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="expenseConfirmed"
              name="Despesa"
              stroke="var(--color-chart-5)"
              strokeWidth={2}
              dot={marcarPontos ? { r: 3 } : false}
              activeDot={{ r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="netConfirmed"
              name="Saldo"
              stroke="var(--color-chart-1)"
              strokeWidth={2}
              dot={marcarPontos ? { r: 3 } : false}
              activeDot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* O mês corrente em números, ao lado do gráfico que o aponta: é a
          comparação que a linha "hoje" sugere, resolvida sem obrigar ninguém a
          passar o cursor. */}
      {mesCorrente ? (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2">
          <span className="text-xs text-muted-foreground">
            {mesCorrente.label} · até hoje
          </span>
          <Inline
            label="receita"
            value={String(mesCorrente.incomeConfirmed)}
            tone="text-foreground"
          />
          <Inline
            label="despesa"
            value={String(mesCorrente.expenseConfirmed)}
            tone="text-foreground"
          />
          <Inline
            label="saldo"
            value={String(mesCorrente.netConfirmed)}
            tone={
              mesCorrente.netConfirmed < 0 ? "text-rose-400" : "text-foreground"
            }
          />
        </div>
      ) : null}
    </div>
  );
}

/** `R$ 12,3 mil` — o eixo precisa caber, e a dica do cursor dá o valor exato. */
const compacto = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
