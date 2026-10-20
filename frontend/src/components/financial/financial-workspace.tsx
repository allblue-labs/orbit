"use client";

/**
 * Financial Workspace — o dinheiro que a operação gera.
 *
 * ## O que este módulo não é
 *
 * Não é contabilidade. Não há plano de contas, partidas dobradas, DRE,
 * conciliação bancária, imposto nem contas a pagar com fornecedor cadastrado.
 * O backend registra o **fato financeiro** — entrou ou saiu, quanto, quando, de
 * que categoria, por qual origem — e é exatamente isso que a tela mostra.
 *
 * ## Orçamento e Recibo moram aqui
 *
 * Os dois são dinheiro: a proposta é a receita que ainda vai existir, o recibo é a
 * que já entrou — e o recibo emitido **vira** lançamento de receita sozinho. O
 * orçamento era item paralelo no menu, que já criava rolagem em tela full HD; o
 * recibo não tinha lugar nenhum, apesar de o gatilho que o transforma em receita
 * existir desde a PR-21.
 *
 * Orçamento tem realce entre as abas, e isso é deliberado: é uma feature principal
 * da aplicação, não a sexta aba de um módulo. Sem o realce, virar aba seria
 * rebaixá-la.
 *
 * ## As abas ficam na URL
 *
 * `?secao=orcamentos` abre a proposta, recarregar não volta para a primeira aba, e
 * voltar no navegador desfaz a troca como desfaz qualquer navegação. É o que permite
 * `/orcamentos` continuar existindo: ela redireciona para cá com a seção pedida.
 *
 * ## Seis abas, uma fonte
 *
 * ```
 * GET /financial/analytics/summary     visão geral: realizado × previsto
 * GET /financial/analytics/timeline    evolução mensal
 * GET /financial/analytics/categories  distribuição
 * GET /financial/entries               lançamentos (paginado)
 * GET /financial/categories            catálogo de categorias
 * GET /commissions/overview            comissão por técnico
 * ```
 *
 * A comissão tem raiz própria (`/commissions`) porque é um controller próprio:
 * lê atendimento, técnico e receita, e não é lançamento do Financeiro. A
 * permissão continua sendo a financeira — é dinheiro a pagar.
 *
 * **Receitas e Despesas não são módulos separados.** São a mesma listagem com
 * `type` fixo — um filtro do servidor, não um recorte local. Escrever três
 * listagens seria a duplicação que o Workspace Core existe para evitar.
 *
 * Cada aba tem `TabBoundary` próprio: a série falhar não derruba a tabela.
 */
import { Suspense } from "react";
import { FileSignature } from "lucide-react";

import { ContentContainer } from "@/components/layout/page-primitives";
import { PanelLoading } from "@/components/panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSectionFromUrl } from "@/hooks/use-section-from-url";
import { useSession } from "@/providers/session-provider";
import { QuotesWorkspace } from "@/components/quotes/quotes-workspace";
import { TabBoundary } from "@/workspace";
import { FINANCIAL_SECTIONS, financialSectionList } from "./sections";
import { FinancialCategoriesTab } from "./tabs/categories.tab";
import { FinancialEntriesTab } from "./tabs/entries.tab";
import { FinancialCommissionsTab } from "./tabs/commissions.tab";
import { FinancialOverviewTab } from "./tabs/overview.tab";
import { FinancialReceiptsTab } from "./receipts/receipts.tab";

/**
 * `useSearchParams` exige um limite de Suspense: a leitura do parâmetro só
 * acontece no cliente. Cada aba resolve o próprio carregamento, então o limite
 * fica restrito a quem lê o endereço.
 */
export function FinancialWorkspace() {
  return (
    <Suspense
      fallback={
        <ContentContainer size="wide">
          <PanelLoading rows={4} />
        </ContentContainer>
      }
    >
      <Workspace />
    </Suspense>
  );
}

function Workspace() {
  const session = useSession();

  /*
   * Orçamento pede a capability dele.
   *
   * Hoje os planos concedem as duas juntas, mas o que sai de um plano no futuro
   * será uma delas — e aí a aba precisa **desaparecer**, não abrir para dar erro.
   * A página inteira continua exigindo `financial.read`, que é a regra dela.
   */
  const canQuotes = session.hasCapability("quotes.read");

  const section = useSectionFromUrl(financialSectionList({ canQuotes }));

  return (
    <ContentContainer size="wide" className="space-y-6">
      <Tabs value={section.current} onValueChange={section.go}>
        <TabsList>
          <TabsTrigger value={FINANCIAL_SECTIONS.overview}>
            Visão geral
          </TabsTrigger>

          {/*
            Orçamento tem realce, e ele é discreto de propósito.

            A primeira tentativa deu borda, fundo tingido e texto colorido ao gatilho:
            ficou exagerado e, pior, a borda somou dois pixels à altura de uma faixa
            de altura fixa — a lista passou a rolar na vertical e as abas pareceram
            amassadas umas nas outras.

            O que sobrou faz o mesmo trabalho sem custar altura: o ícone, e a cor de
            marca só no texto enquanto a aba está inativa. Ativa, ela é igual às
            outras — ali já está onde a pessoa olha.
          */}
          {canQuotes ? (
            <TabsTrigger
              value={FINANCIAL_SECTIONS.quotes}
              className="gap-1.5 text-primary data-[state=active]:text-foreground"
            >
              <FileSignature className="size-3.5" />
              Orçamentos
            </TabsTrigger>
          ) : null}

          <TabsTrigger value={FINANCIAL_SECTIONS.receipts}>Recibos</TabsTrigger>
          <TabsTrigger value={FINANCIAL_SECTIONS.entries}>
            Lançamentos
          </TabsTrigger>
          <TabsTrigger value={FINANCIAL_SECTIONS.income}>Receitas</TabsTrigger>
          <TabsTrigger value={FINANCIAL_SECTIONS.expense}>Despesas</TabsTrigger>
          <TabsTrigger value={FINANCIAL_SECTIONS.commissions}>
            Comissão
          </TabsTrigger>
          <TabsTrigger value={FINANCIAL_SECTIONS.categories}>
            Categorias
          </TabsTrigger>
        </TabsList>

        <TabsContent value={FINANCIAL_SECTIONS.overview}>
          <TabBoundary id="financial-overview" label="a visão geral">
            <FinancialOverviewTab />
          </TabBoundary>
        </TabsContent>

        {canQuotes ? (
          <TabsContent value={FINANCIAL_SECTIONS.quotes}>
            {/* Só monta na aba ativa: a área de propostas carrega indicadores e
                listagem, e abrir o Financeiro não deveria disparar essas
                consultas. */}
            {section.current === FINANCIAL_SECTIONS.quotes ? (
              <TabBoundary id="financial-quotes" label="os orçamentos">
                <QuotesWorkspace embedded />
              </TabBoundary>
            ) : null}
          </TabsContent>
        ) : null}

        <TabsContent value={FINANCIAL_SECTIONS.receipts}>
          {/* Só monta na aba ativa: a lista consulta as execuções de artefato
              recortadas por tipo, e abrir o Financeiro não deveria disparar isso. */}
          {section.current === FINANCIAL_SECTIONS.receipts ? (
            <TabBoundary id="financial-receipts" label="os recibos">
              <FinancialReceiptsTab />
            </TabBoundary>
          ) : null}
        </TabsContent>

        <TabsContent value={FINANCIAL_SECTIONS.entries}>
          <TabBoundary id="financial-entries" label="os lançamentos">
            <FinancialEntriesTab
              noun="lançamento"
              emptyTitle="Nenhum lançamento"
              emptyDescription="Registre uma receita ou despesa, ou emita um recibo — recibos viram receita automaticamente."
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value={FINANCIAL_SECTIONS.income}>
          <TabBoundary id="financial-income" label="as receitas">
            <FinancialEntriesTab
              type="INCOME"
              noun="receita"
              gender="f"
              emptyTitle="Nenhuma receita"
              emptyDescription="Recibos oficialmente emitidos entram aqui sozinhos, já confirmados."
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value={FINANCIAL_SECTIONS.expense}>
          <TabBoundary id="financial-expense" label="as despesas">
            <FinancialEntriesTab
              type="EXPENSE"
              noun="despesa"
              gender="f"
              emptyTitle="Nenhuma despesa"
              emptyDescription="Peças, deslocamento, mão de obra — o que sai do caixa é registrado manualmente."
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value={FINANCIAL_SECTIONS.commissions}>
          <TabBoundary id="financial-commissions" label="a comissão">
            <FinancialCommissionsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value={FINANCIAL_SECTIONS.categories}>
          <TabBoundary id="financial-categories" label="as categorias">
            <FinancialCategoriesTab />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </ContentContainer>
  );
}
