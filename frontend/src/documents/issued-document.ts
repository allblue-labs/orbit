/**
 * Baixar e compartilhar um documento emitido — as decisões, sem a tela.
 *
 * ## Por que existe
 *
 * Baixar o documento de uma OS, de um recibo ou de um orçamento exigia sair da
 * lista e abrir a página da execução. As listas (cliente, documentos emitidos)
 * e as páginas de detalhe passaram a oferecer a ação no lugar — e todas pelo
 * mesmo caminho, porque todo documento oficial do produto é uma execução de
 * artefato com uma revisão emitida: OS, RVT, PMOC, orçamento e recibo.
 *
 * ## Por que compartilhar é o arquivo, e não um link
 *
 * A URL que dá acesso ao documento é **assinada, pessoal e curta** (minutos).
 * Mandá-la por mensagem entregaria ao cliente um link que morre antes de ele
 * abrir — e, enquanto vale, dá acesso sem sessão. O que se compartilha é o
 * próprio PDF, pela folha de compartilhamento do sistema (WhatsApp, e-mail,
 * AirDrop): nenhum link sai do Orbit.
 */
import type { ArtifactManifestSummary } from "@/types/documents";

/**
 * A revisão que vale: ativa, emitida e com conteúdo.
 *
 * É a mesma regra do download da página da operação. Uma revisão emitida sem
 * `contentHash` é registro sem arquivo; uma substituída é história.
 */
export function pickIssuedManifest(
  manifests: readonly ArtifactManifestSummary[],
): ArtifactManifestSummary | null {
  const validas = manifests.filter(
    (item) =>
      item.isActive && item.status === "ISSUED" && Boolean(item.contentHash),
  );
  if (validas.length === 0) return null;
  /* Mais de uma ativa não deveria existir — o servidor garante uma só. Se
     acontecer, a revisão mais alta é a mais recente, e é ela que se entrega. */
  return [...validas].sort((a, b) => b.revision - a.revision)[0]!;
}

/**
 * O documento está emitido?
 *
 * `READY` é publicado **depois** de a revisão ser emitida (o processador emite
 * e só então marca pronto), então é sinal fiel. Usado para decidir se a ação
 * aparece — sem uma consulta por linha.
 */
export function isDocumentIssued(renderStatus: string | null | undefined) {
  return renderStatus === "READY";
}

const EXTENSOES: Readonly<Record<string, string>> = {
  "application/pdf": "pdf",
  "text/html": "html",
  "application/json": "json",
};

/**
 * O nome com que o arquivo chega a quem recebe.
 *
 * "documento.pdf" não diz nada a quem abre o anexo. Código e título dizem de
 * que atendimento é. Os caracteres que sistemas de arquivo recusam saem; acentos
 * ficam, porque o nome é lido por gente.
 */
export function issuedFileName(
  parts: { code?: string | null; title?: string | null },
  mimeType: string,
): string {
  const extensao = EXTENSOES[mimeType.split(";")[0]!.trim()] ?? "pdf";
  const base = [parts.code, parts.title]
    .map((parte) => parte?.trim())
    .filter((parte): parte is string => Boolean(parte))
    .join(" - ")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .trim();
  return `${base || "documento"}.${extensao}`;
}

/** O que o navegador sabe fazer com um arquivo. */
export type ShareSupport = "files" | "none";

/**
 * Este navegador compartilha **arquivos**?
 *
 * `navigator.share` existir não basta: vários navegadores compartilham texto e
 * recusam arquivo. `canShare({ files })` é a pergunta certa — e quem responde
 * "não" recebe o download, que é o que dá para anexar à mão.
 */
export function shareSupport(
  nav: Pick<Navigator, "share" | "canShare"> | undefined,
  file: File,
): ShareSupport {
  if (!nav || typeof nav.share !== "function") return "none";
  if (typeof nav.canShare !== "function") return "none";
  try {
    return nav.canShare({ files: [file] }) ? "files" : "none";
  } catch {
    return "none";
  }
}

/**
 * Como o compartilhamento terminou.
 *
 * `activation` é o caso que pede um segundo toque: o navegador só aceita abrir a
 * folha de compartilhamento logo após um gesto da pessoa, e o tempo de buscar o
 * arquivo pode ter passado do limite (o Safari é rigoroso). O arquivo já está
 * em mãos; o segundo toque abre a folha na hora.
 */
export type ShareOutcome = "shared" | "cancelled" | "activation" | "failed";

export function shareOutcomeOf(error: unknown): ShareOutcome {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name: unknown }).name)
      : "";
  if (name === "AbortError") return "cancelled";
  if (name === "NotAllowedError") return "activation";
  return "failed";
}
