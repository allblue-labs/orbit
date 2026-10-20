"use client";

/**
 * Quotes Workspace — propostas comerciais.
 *
 * ## As cinco abas eram um filtro disfarçado
 *
 * Todas chamavam `GET /quotes` com um `status` diferente. Nada mudava de tela:
 * mesma tabela, mesmas colunas, mesma paginação, mesmo endpoint — só o recorte.
 * Aba é para trocar de assunto; isto era trocar de **situação**, que é o que um
 * filtro faz. O preço de disfarçá-lo era real: a faixa de abas ficava entre a
 * pessoa e a lista, "Encerrados" precisava de um seletor próprio **dentro** da
 * aba para escolher entre recusa, expiração e cancelamento, e combinar situação
 * com cliente ou validade obrigava a lembrar em qual aba o outro filtro estava.
 *
 * Agora é uma lista com a situação na barra de filtros, ao lado dos outros
 * recortes — e as seis situações são escolhas de igual peso, inclusive os três
 * desfechos que antes viviam escondidos num seletor de segundo nível.
 *
 * ```
 * GET /quotes                  todas
 * GET /quotes?status=DRAFT     em elaboração
 * GET /quotes?status=SENT      enviadas, aguardando decisão
 * ...
 * ```
 *
 * Os indicadores ficam fora da lista: eles respondem pela carteira inteira, e
 * não pelo recorte em vigor.
 */
import { ContentContainer } from "@/components/layout/page-primitives";
import { TabBoundary } from "@/workspace";
import { QuoteKpis } from "./quote-kpis";
import { QuotesList } from "./quotes-list";

/**
 * `embedded` quando o workspace vive **dentro** de outra aba.
 *
 * Orçamento passou a ser aba do Financeiro, e lá o contêiner e o espaçamento são
 * da página de fora: repetir o `ContentContainer` aqui aplicaria a largura máxima
 * duas vezes e o conteúdo apareceria mais estreito que as abas irmãs.
 *
 * A rota `/orcamentos` continua existindo e redireciona para a aba — então este
 * componente não tem mais um caminho próprio hoje. O parâmetro fica porque a
 * alternativa era o componente assumir que está sempre embutido, e aí a próxima
 * página que o usasse herdaria um layout sem contêiner sem ninguém perceber.
 */
export function QuotesWorkspace({ embedded = false }: { embedded?: boolean }) {
  const content = (
    <>
      {/*
        Dois limites, e não um: os indicadores agregam a carteira e a lista
        consulta uma página dela. São consultas diferentes, e uma falhando não
        deve apagar a outra da tela.
      */}
      <TabBoundary id="quotes-kpis" label="os indicadores">
        <QuoteKpis />
      </TabBoundary>

      <TabBoundary id="quotes-all" label="as propostas">
        <QuotesList
          emptyTitle="Nenhuma proposta"
          emptyDescription="Crie um orçamento para um cliente. Ele nasce em rascunho e só vai ao cliente quando você enviar."
        />
      </TabBoundary>
    </>
  );

  return embedded ? (
    <div className="space-y-6">{content}</div>
  ) : (
    <ContentContainer size="wide" className="space-y-6">
      {content}
    </ContentContainer>
  );
}
