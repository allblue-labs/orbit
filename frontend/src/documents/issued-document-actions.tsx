"use client";

/**
 * Baixar ou compartilhar um documento emitido, de onde ele aparece.
 *
 * ## Tudo acontece no toque
 *
 * Nada é buscado ao desenhar. A versão da página de operação busca revisão e
 * URL assinada ao montar — três requisições por documento. Numa lista de vinte
 * linhas seriam sessenta, e as URLs vencem em minutos: quem rolasse a lista e
 * voltasse depois tocaria num link morto. Aqui a revisão e a URL são pedidas no
 * instante do toque, e usadas logo em seguida.
 *
 * ## Compartilhar é o arquivo
 *
 * Ver `issued-document.ts`. Onde o navegador não compartilha arquivo, a ação
 * baixa e diz isso — anexar à mão é o que resta, e é melhor do que um botão que
 * não faz nada.
 */
import { useRef, useState } from "react";
import { Download, Loader2, Share2 } from "lucide-react";

import { useAction } from "@/actions";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { browserUrlFor } from "@/lib/backend-url";
import { errorCopy } from "@/lib/error-copy";
import { notifyError, notifyInfo } from "@/lib/notify";
import { documentsService } from "@/services/documents.service";
import { managementReportsService } from "@/services/management-reports.service";
import {
  isDocumentIssued,
  issuedFileName,
  pickIssuedManifest,
  shareOutcomeOf,
  shareSupport,
} from "./issued-document";

/**
 * De onde vem o arquivo.
 *
 * Documento de atendimento (execução) tem revisões, e o arquivo é o da revisão
 * emitida ativa. Relatório gerencial tem um arquivo só, entregue pelo próprio
 * relatório. A lista de "Documentos emitidos" mostra os dois lado a lado.
 */
type Origem =
  | { readonly executionId: string; readonly reportId?: never }
  | { readonly reportId: string; readonly executionId?: never };

type Props = Origem & {
  readonly renderStatus: string | null | undefined;
  /** Para o nome do arquivo: "OS-000072 - Clínica Sol.pdf". */
  readonly code?: string | null;
  readonly title?: string | null;
  /**
   * `icon` para linhas de lista (só ícones, rótulo na dica); `full` para
   * cabeçalhos de página, com o texto à vista.
   */
  readonly variant?: "icon" | "full";
};

class NoIssuedRevision extends Error {}

/** O arquivo não pôde ser lido pela página, mas o link assinado existe. */
class FetchBlocked extends Error {
  constructor(
    readonly url: string,
    readonly cause: unknown,
  ) {
    super("fetch blocked");
  }
}

export function IssuedDocumentActions({
  executionId,
  reportId,
  renderStatus,
  code,
  title,
  variant = "icon",
}: Props) {
  const executionDownload = useAction("artifact-execution.download-document");
  const executionShare = useAction("artifact-execution.share-document");
  const reportDownload = useAction("management-report.download");
  /* Relatório não tem ação própria de compartilhar: quem pode baixar o arquivo
     já pode enviá-lo — a mesma regra que liberou o compartilhar de execução. */
  const download = reportId ? reportDownload : executionDownload;
  const share = reportId ? reportDownload : executionShare;
  const [busy, setBusy] = useState<"download" | "share" | null>(null);

  /**
   * O arquivo já buscado, quando o navegador pediu um segundo toque.
   *
   * Ver `ShareOutcome.activation`: a folha de compartilhamento só abre logo
   * após um gesto, e buscar o arquivo pode passar do limite. Guardado aqui, o
   * segundo toque compartilha na hora, sem buscar de novo.
   */
  const preparado = useRef<File | null>(null);
  const [aguardandoToque, setAguardandoToque] = useState(false);

  if (!isDocumentIssued(renderStatus) || !download.allowed) return null;

  /** A URL assinada do arquivo, pedida agora — ela vence em minutos. */
  const assinar = async () => {
    if (reportId)
      return managementReportsService.signedUrl(reportId, "download");
    const revisoes = await documentsService.manifests(executionId!);
    const revisao = pickIssuedManifest(revisoes.data);
    if (!revisao) throw new NoIssuedRevision();
    return documentsService.signedUrl(revisao.id, "download");
  };

  const buscarArquivo = async (): Promise<File> => {
    const assinada = await assinar();
    const endereco = browserUrlFor(assinada.url);
    let resposta: Response;
    try {
      resposta = await fetch(endereco, {
        headers: assinada.requiredHeaders,
        credentials: "same-origin",
      });
    } catch (error) {
      /* Falha de rede antes de qualquer resposta — no armazenamento externo,
         tipicamente a CORS do bucket. O link assinado continua válido. */
      throw new FetchBlocked(endereco, error);
    }
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const blob = await resposta.blob();
    return new File([blob], issuedFileName({ code, title }, blob.type), {
      type: blob.type || "application/pdf",
    });
  };

  const salvar = (arquivo: File) => {
    const url = URL.createObjectURL(arquivo);
    const ancora = document.createElement("a");
    ancora.href = url;
    ancora.download = arquivo.name;
    document.body.appendChild(ancora);
    ancora.click();
    ancora.remove();
    /* O navegador precisa do endereço até começar a gravar; liberar no mesmo
       ciclo cancelaria o download em alguns deles. */
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const avisarFalha = (error: unknown) => {
    if (error instanceof FetchBlocked) {
      notifyError(
        "O navegador não conseguiu preparar o arquivo para compartilhar.",
        "Use Baixar e anexe o arquivo na conversa ou no e-mail.",
      );
      return;
    }
    if (error instanceof NoIssuedRevision) {
      notifyError(
        "Este documento não tem revisão emitida para baixar.",
        "Abra o documento para conferir a emissão.",
      );
      return;
    }
    notifyError("Não foi possível obter o documento.", errorCopy(error));
  };

  const baixar = async () => {
    setBusy("download");
    try {
      salvar(await buscarArquivo());
    } catch (error) {
      /* Baixar ainda é possível pelo próprio link: o navegador o abre e o
         cabeçalho assinado pede para salvar. Só compartilhar precisa do
         arquivo em mãos. */
      if (error instanceof FetchBlocked) {
        window.open(error.url, "_blank", "noopener,noreferrer");
        return;
      }
      avisarFalha(error);
    } finally {
      setBusy(null);
    }
  };

  const enviar = async (arquivo: File) => {
    try {
      await navigator.share({ files: [arquivo], title: arquivo.name });
      preparado.current = null;
      setAguardandoToque(false);
    } catch (error) {
      const desfecho = shareOutcomeOf(error);
      if (desfecho === "cancelled") return;
      if (desfecho === "activation") {
        preparado.current = arquivo;
        setAguardandoToque(true);
        return;
      }
      notifyError("Não foi possível compartilhar o documento.");
    }
  };

  const compartilhar = async () => {
    /* Segundo toque: o arquivo já está aqui, e a folha abre dentro do gesto. */
    if (preparado.current) {
      await enviar(preparado.current);
      return;
    }
    setBusy("share");
    try {
      const arquivo = await buscarArquivo();
      if (shareSupport(navigator, arquivo) === "none") {
        salvar(arquivo);
        notifyInfo(
          "Documento baixado para você enviar.",
          "Este navegador não compartilha arquivos diretamente. Anexe o arquivo baixado na conversa ou no e-mail.",
        );
        return;
      }
      await enviar(arquivo);
    } catch (error) {
      avisarFalha(error);
    } finally {
      setBusy(null);
    }
  };

  const rotuloCompartilhar = aguardandoToque
    ? "Toque para enviar"
    : "Compartilhar";

  return (
    <div
      className="inline-flex items-center gap-1"
      /* Linhas de lista são links inteiros; a ação não abre a linha. */
      onClick={(event) => event.stopPropagation()}
    >
      <Acao
        variant={variant}
        rotulo="Baixar"
        dica={`Baixar ${title ?? "documento"}`}
        icone={<Download className="size-4" />}
        ocupado={busy === "download"}
        desabilitado={busy !== null}
        onClick={() => void baixar()}
      />
      {share.allowed ? (
        <Acao
          variant={variant}
          rotulo={rotuloCompartilhar}
          dica={
            aguardandoToque
              ? "O arquivo está pronto. Toque de novo para escolher para onde enviar."
              : `Compartilhar ${title ?? "documento"}`
          }
          icone={<Share2 className="size-4" />}
          ocupado={busy === "share"}
          desabilitado={busy !== null}
          destaque={aguardandoToque}
          onClick={() => void compartilhar()}
        />
      ) : null}
    </div>
  );
}

function Acao({
  variant,
  rotulo,
  dica,
  icone,
  ocupado,
  desabilitado,
  destaque = false,
  onClick,
}: {
  variant: "icon" | "full";
  rotulo: string;
  dica: string;
  icone: React.ReactNode;
  ocupado: boolean;
  desabilitado: boolean;
  destaque?: boolean;
  onClick: () => void;
}) {
  const conteudo = ocupado ? <Loader2 className="size-4 animate-spin" /> : icone;
  if (variant === "full") {
    return (
      <Button
        type="button"
        size="sm"
        variant={destaque ? "default" : "outline"}
        disabled={desabilitado}
        onClick={onClick}
      >
        {conteudo}
        {rotulo}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={destaque ? "default" : "ghost"}
          className="size-8"
          disabled={desabilitado}
          aria-label={dica}
          onClick={onClick}
        >
          {conteudo}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {dica}
      </TooltipContent>
    </Tooltip>
  );
}
