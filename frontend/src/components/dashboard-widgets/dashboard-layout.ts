/**
 * Como os widgets se arrumam na página.
 *
 * ## Por que o modelo anterior não parava de errar
 *
 * Ele era "colunas": um widget de largura total virava faixa, e entre duas faixas
 * havia um bloco com uma coluna principal e uma lateral, onde a lateral recebia **o
 * primeiro widget estreito**. Duas coisas invisíveis decidiam o resultado:
 *
 * 1. a existência de um widget `FULL` para separar os blocos;
 * 2. qual widget acontecia de ser o primeiro estreito do bloco.
 *
 * Nenhuma das duas é estável. O resolver do servidor **filtra** por plano,
 * permissão e módulo: basta o Centro de Atenção não ser concedido para que dois
 * blocos virem um só, e aí a Saúde Financeira deixa de dividir a linha com o Índice
 * de Saúde e cai numa pilha de dois em dois, com o Índice embaixo dela. O painel
 * mudava de arrumação por causa de um widget que nem aparece.
 *
 * ## O modelo: linhas, formadas aos pares
 *
 * Agora a lista ordenada é percorrida e **emparelhada em linhas de doze colunas**.
 * Nada depende de separador nem de posição:
 *
 * ```text
 * ┌ Radar (4) ──┐ ┌ Indicadores Executivos (8) ───────────┐
 * ├ Centro de Atenção (12) ───────────────────────────────┤
 * ├ Saúde Financeira (8) ─────────┐ ┌ Índice de Saúde (4) ┤
 * ├ Tendência Operacional (12) ───────────────────────────┤
 * ├ Desempenho da Equipe (12) ────────────────────────────┤
 * ├ Atividades Recentes (6) ──────┐ ┌ Próximos Eventos (6)┤
 * └ Inteligência Orbit (12) ──────────────────────────────┘
 * ```
 *
 * Os dois widgets de uma linha são itens da **mesma** linha da grade, então o mais
 * alto define a altura e o outro acompanha — é assim que o Índice de Saúde termina
 * onde a Saúde Financeira termina, inclusive depois de ela crescer com o gráfico, e
 * sem ninguém medir conteúdo.
 *
 * Tirar um widget do meio não reorganiza a página: os vizinhos se emparelham e o
 * resto continua igual. Era exatamente isso que faltava.
 */
import type { ResolvedDashboardWidget } from "@/types/dashboard";

/** Quantas das doze colunas o widget ocupa na linha dele. */
export type Colunas = 4 | 6 | 8 | 12;

export interface WidgetNaLinha<T> {
  readonly widget: T;
  readonly colunas: Colunas;
}

/** Uma linha da grade de doze colunas: um widget ou um par. */
export interface LinhaDoPainel<T> {
  readonly widgets: readonly WidgetNaLinha<T>[];
}

type ComTamanho = Pick<ResolvedDashboardWidget, "size">;

/** Ocupa a linha inteira sozinho. */
export function ehFaixaInteira(widget: ComTamanho): boolean {
  return widget.size === "FULL";
}

/** Cabe ao lado de outro. */
export function ehEstreito(widget: ComTamanho): boolean {
  return widget.size === "SMALL" || widget.size === "MEDIUM";
}

/**
 * Distribui os widgets em linhas de doze colunas, **preservando a ordem**.
 *
 * As regras, aplicadas ao par (atual, seguinte):
 *
 * - `FULL` ocupa a linha sozinho — é o que o tamanho declara.
 * - estreito + estreito → 6 e 6, meio a meio.
 * - largo + estreito → 8 e 4, e o estreito fica à direita.
 * - estreito + largo → 4 e 8: o largo "ocupa o espaço restante", que é o pedido
 *   feito para os Indicadores Executivos ao lado do Radar.
 * - largo + largo → cada um na sua linha. Dois gráficos a seis colunas num painel
 *   ficam ilegíveis, e ilegível é pior que alto.
 * - estreito sozinho no fim → meia linha. Doze colunas para um cartão pequeno o
 *   deformariam; o vazio à direita diz a verdade, que é "acabou aqui".
 *
 * ## Os estreitos se emparelham entre si primeiro
 *
 * Um largo só adota o estreito seguinte quando esse estreito **não** tem um par
 * estreito depois dele. Sem essa prioridade o emparelhamento ganancioso rouba:
 * Desempenho da Equipe (largo) adotava Atividades Recentes, e Próximos Eventos
 * sobrava sozinho numa linha — quando os dois foram pedidos lado a lado.
 *
 * A regra é de uma olhada à frente, não de otimização global: previsível de ler no
 * registry, e sem nenhuma medida de conteúdo envolvida.
 */
export function organizarPainel<T extends ComTamanho>(
  widgets: readonly T[],
): readonly LinhaDoPainel<T>[] {
  const linhas: LinhaDoPainel<T>[] = [];

  for (let indice = 0; indice < widgets.length; indice += 1) {
    const atual = widgets[indice]!;

    if (ehFaixaInteira(atual)) {
      linhas.push({ widgets: [{ widget: atual, colunas: 12 }] });
      continue;
    }

    const seguinte = widgets[indice + 1];
    const cabeNaLinha = seguinte && !ehFaixaInteira(seguinte);

    /*
     * O estreito seguinte já tem par estreito depois dele.
     *
     * Então ele não é adotado por este largo: Desempenho da Equipe adotava
     * Atividades Recentes e deixava Próximos Eventos sozinho numa linha.
     */
    const seguinteJaTemPar =
      cabeNaLinha &&
      !ehEstreito(atual) &&
      ehEstreito(seguinte) &&
      ehEstreitoLivre(widgets[indice + 2]);

    /* Largo sozinho, dois largos seguidos, ou o estreito seguinte já comprometido. */
    if (
      !cabeNaLinha ||
      seguinteJaTemPar ||
      (!ehEstreito(atual) && !ehEstreito(seguinte))
    ) {
      linhas.push({
        widgets: [{ widget: atual, colunas: ehEstreito(atual) ? 6 : 12 }],
      });
      continue;
    }

    const [esquerda, direita] = reparticao(atual, seguinte);
    linhas.push({
      widgets: [
        { widget: atual, colunas: esquerda },
        { widget: seguinte, colunas: direita },
      ],
    });
    /* O seguinte já entrou nesta linha. */
    indice += 1;
  }

  return linhas;
}

/** Existe, é estreito e não é faixa — ou seja, serve de par para o vizinho. */
function ehEstreitoLivre(widget: ComTamanho | undefined): boolean {
  return Boolean(widget) && !ehFaixaInteira(widget!) && ehEstreito(widget!);
}

/** Como as doze colunas se dividem entre dois widgets que cabem na mesma linha. */
function reparticao(
  esquerda: ComTamanho,
  direita: ComTamanho,
): readonly [Colunas, Colunas] {
  if (ehEstreito(esquerda) && ehEstreito(direita)) return [6, 6];
  if (ehEstreito(esquerda)) return [4, 8];
  return [8, 4];
}
