/**
 * Como uma linha da central se identifica e para onde ela leva.
 *
 * ## Por que isto não vive no JSX
 *
 * Porque a central passou a listar duas coisas que não se descrevem igual. Uma
 * execução tem código e título; um relatório gerencial não tem nem um nem outro —
 * ele se identifica pelo tipo e pelo período que retrata. Resolver isso dentro do
 * `map` da tabela significaria um encadeamento de ternários por célula, e a
 * concordância do texto e o destino do link ficariam sem como ser provados.
 *
 * ## O destino não é o mesmo
 *
 * Execução abre a tela da execução, onde se assina e se emite. Relatório abre a
 * página dele. Mandar os dois para o mesmo lugar daria 404 em metade das linhas.
 */
import { ROUTES } from "@/lib/routes";
import { templateTypeLabel } from "@/artifacts";
import type { IssuedDocument } from "@/types/issued-documents";

/** Rótulos de tipo de relatório, como o catálogo do servidor os publica. */
export type ReportTypeLabels = Readonly<Record<string, string>>;

export interface IssuedDocumentIdentity {
  /** A linha de cima: o que a pessoa procura na lista. */
  readonly primary: string;
  /** A linha de baixo, quando há o que dizer. */
  readonly secondary: string | null;
  /** `true` quando a linha de baixo é um código — a tela a mostra em monoespaçada. */
  readonly secondaryIsCode: boolean;
}

/**
 * O nome do tipo.
 *
 * Os dois vocabulários são diferentes e nenhum dos dois é traduzido pelo outro: o
 * tipo de artefato vem do registro local, o de relatório vem do catálogo do
 * servidor. Tipo desconhecido aparece cru em vez de virar "—": um valor novo
 * publicado pelo backend deve ser legível antes de alguém atualizar o registro.
 */
export function issuedDocumentTypeLabel(
  document: IssuedDocument,
  reportTypes: ReportTypeLabels = {},
): string {
  if (document.source === "REPORT") {
    return reportTypes[document.type] ?? document.type;
  }
  return templateTypeLabel(document.type);
}

/**
 * Como a linha se apresenta.
 *
 * A execução mostra título e código. O relatório mostra o tipo e o período — e é o
 * período que responde "qual relatório é este", porque o mesmo tipo é gerado todo
 * mês.
 */
export function issuedDocumentIdentity(
  document: IssuedDocument,
  reportTypes: ReportTypeLabels = {},
  formatPeriod: PeriodFormatter = defaultPeriod,
): IssuedDocumentIdentity {
  if (document.source === "REPORT") {
    return {
      primary: issuedDocumentTypeLabel(document, reportTypes),
      secondary:
        document.periodFrom && document.periodTo
          ? formatPeriod(document.periodFrom, document.periodTo)
          : null,
      secondaryIsCode: false,
    };
  }

  /* Título vazio não acontece no contrato, mas uma linha sem nada na primeira
     coluna seria invisível na lista — então o código assume o lugar. */
  return {
    primary: document.title?.trim() || document.code || "Sem título",
    secondary: document.title?.trim() ? document.code : null,
    secondaryIsCode: true,
  };
}

/** Para onde a linha leva. Cada origem tem a tela dela. */
export function issuedDocumentHref(document: IssuedDocument): string {
  return document.source === "REPORT"
    ? `${ROUTES.managementReports}/${document.id}`
    : `${ROUTES.executions}/${document.id}`;
}

/**
 * Esta linha tem revisões para folhear?
 *
 * Só a execução: o visualizador lê manifestos, e relatório gerencial não tem
 * manifesto — ele tem um arquivo, que a página dele entrega. Oferecer "abrir"
 * numa linha de relatório abriria um visualizador vazio.
 */
export function hasRevisionHistory(document: IssuedDocument): boolean {
  return document.source === "EXECUTION";
}

/** Como o período é escrito. */
export type PeriodFormatter = (from: string, to: string) => string;

/**
 * O período, em UTC — porque é em UTC que ele foi gravado.
 *
 * Os dois limites são meia-noite UTC da data civil que a pessoa escolheu no
 * formulário (`type="date"` manda `YYYY-MM-DD`, e o contrato o interpreta assim).
 * `formatDate` da casa escreve no fuso de quem olha, e aqui isso **muda o dado**:
 * `2026-03-01T00:00:00Z` lido em Recife é 28 de fevereiro, e um relatório de março
 * passa a se apresentar começando em fevereiro. Quem o recebeu assim não tem como
 * saber que não é erro de dado.
 *
 * O fuso de agregação do relatório é outra informação — ela existe, e mora na
 * página dele, ao lado dos números que ela explica.
 */
function defaultPeriod(from: string, to: string): string {
  const formato = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${formato.format(new Date(from))} a ${formato.format(new Date(to))}`;
}
