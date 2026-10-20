"use client";

/**
 * A identidade QR do equipamento.
 *
 * ## Por que o QR não é mais desenhado aqui
 *
 * Até a PR-FE-05 esta seção codificava `asset.identifier` no navegador com
 * `qrcode.react`. Era um **segundo mecanismo de QR**: gerava um código que a
 * etiqueta impressa pelo backend não conhece, apontando para uma resolução
 * diferente. Dois QRs para o mesmo equipamento é um convite a colar o errado
 * na máquina.
 *
 * A PR-31 tornou a identidade um fato do domínio: cada equipamento recebe, por
 * gatilho no banco, um token opaco de 43 caracteres, e o backend imprime a
 * etiqueta. O que esta tela faz agora é **administrar** essa identidade — ver,
 * baixar e rotacionar. Nenhum pixel do código é gerado aqui.
 *
 * ## O token não aparece
 *
 * `GET /assets/:id/qr` devolve situação e datas, e deliberadamente **não**
 * devolve o token. Não é limitação a contornar: o token vive na etiqueta e na
 * URL de quem a leu; transformá-lo em texto copiável nesta tela o espalharia
 * por prints, chats e planilhas, e ele é o que dá acesso ao contexto do
 * equipamento para quem já tem permissão.
 */
import { useEffect, useState } from "react";
import { Download, QrCode, RefreshCw } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useEquipmentQr,
  useRotateEquipmentQr,
} from "@/hooks/equipment-qr/use-equipment-qr";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useSession } from "@/providers/session-provider";
import { LABEL_FORMATS, qrStatus, type QrTone } from "@/registry";
import { equipmentQrService } from "@/services/equipment-qr.service";
import type { Asset } from "@/types/assets";

const TONE: Readonly<Record<QrTone, string>> = {
  neutral: "bg-surface-strong text-muted-foreground",
  info: "bg-primary/15 text-primary",
  warning: "bg-amber-500/15 text-amber-400",
  critical: "bg-destructive/15 text-destructive",
  success: "bg-emerald-500/15 text-emerald-400",
};

export function IdentifierSection({ asset }: { asset: Asset }) {
  const session = useSession();
  const canManage = session.hasPermission("assets.qr.manage");
  const qr = useEquipmentQr(asset.id);
  const status = qrStatus(qr.data?.status);

  return (
    <PanelFrame
      panelId="asset-identifier"
      title="QR do equipamento"
      description="Identidade da etiqueta física"
      actions={
        qr.data ? (
          <Badge
            variant="secondary"
            className={cn("border-none", TONE[status.tone])}
            title={status.description}
          >
            {status.label}
          </Badge>
        ) : null
      }
    >
      {qr.isPending ? (
        <div className="flex gap-4">
          <Skeleton className="size-36 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        </div>
      ) : qr.error ? (
        /**
         * Ausência de identidade é falha técnica, não estado de produto: o
         * gatilho do banco cria uma para todo equipamento. Por isso a saída é
         * tentar de novo — e não um botão "gerar QR", que ofereceria uma
         * escolha que o domínio não tem.
         */
        <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
          <QrCode className="size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar a identidade QR deste equipamento.
          </p>
          <Button size="sm" variant="outline" onClick={() => void qr.refetch()}>
            Tentar novamente
          </Button>
        </div>
      ) : qr.data ? (
        <div className="flex flex-wrap items-start gap-5">
          <LabelPreview equipmentId={asset.id} name={asset.name} />

          <div className="min-w-0 flex-1 space-y-4">
            <dl className="space-y-1 text-sm">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">Criada em:</dt>
                <dd>{formatDateTime(String(qr.data.createdAt))}</dd>
              </div>
              {qr.data.lastRotatedAt ? (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-muted-foreground">Última rotação:</dt>
                  <dd>{formatDateTime(String(qr.data.lastRotatedAt))}</dd>
                </div>
              ) : null}
            </dl>

            <DownloadRow equipmentId={asset.id} />

            {canManage ? <RotateAction equipmentId={asset.id} /> : null}

            <p className="text-xs text-muted-foreground">
              A etiqueta leva quem a lê ao contexto deste equipamento. Ler o
              código não concede acesso: as permissões de quem abre continuam
              valendo.
            </p>
          </div>
        </div>
      ) : null}
    </PanelFrame>
  );
}

/**
 * A pré-visualização é a **etiqueta do backend**, não um desenho local.
 *
 * O SVG chega como bytes pelo cliente canônico e é exibido por `<img>` sobre
 * um object URL. Injetar a marcação com `dangerouslySetInnerHTML` colocaria
 * SVG de terceiro dentro do DOM da aplicação — e SVG é um documento que pode
 * carregar script. O `<img>` renderiza a imagem sem lhe dar essa porta.
 */
function LabelPreview({
  equipmentId,
  name,
}: {
  equipmentId: string;
  name: string;
}) {
  const [source, setSource] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    equipmentQrService
      .label(equipmentId, { format: "svg", preset: "STANDARD" })
      .then((label) => {
        if (cancelled) return;
        url = URL.createObjectURL(label.blob);
        setSource(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      /** O object URL segura o blob em memória até ser revogado. */
      if (url) URL.revokeObjectURL(url);
    };
  }, [equipmentId]);

  if (failed) {
    return (
      <div className="flex size-36 items-center justify-center rounded-lg border border-border">
        <QrCode className="size-6 text-muted-foreground" aria-hidden />
      </div>
    );
  }

  if (!source) return <Skeleton className="size-36 rounded-lg" />;

  return (
    <div className="rounded-lg bg-white p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        /** O texto alternativo nomeia o equipamento — nunca o token. */
        alt={`Etiqueta QR do equipamento ${name}`}
        className="size-32 object-contain"
      />
    </div>
  );
}

function DownloadRow({ equipmentId }: { equipmentId: string }) {
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * O download é o arquivo do servidor, com o nome que ele escolheu.
   *
   * Nada é convertido para base64 nem remontado aqui: os bytes vão do BFF para
   * um object URL e daí para o disco.
   */
  const download = async (format: "svg" | "png" | "pdf") => {
    setBusy(format);
    try {
      const label = await equipmentQrService.label(equipmentId, {
        format,
        preset: "STANDARD",
        branding: "ORGANIZATION",
      });
      const url = URL.createObjectURL(label.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = label.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Baixar etiqueta</p>
      <div className="flex flex-wrap gap-2">
        {LABEL_FORMATS.map((entry) => (
          <Button
            key={entry.format}
            size="sm"
            variant="outline"
            title={entry.hint}
            aria-label={`Baixar etiqueta em ${entry.label}`}
            disabled={busy !== null}
            onClick={() => void download(entry.format)}
          >
            <Download className="size-3.5" />
            {busy === entry.format ? "Gerando…" : entry.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Rotacionar é trocar a etiqueta, não apagar o equipamento.
 *
 * A confirmação diz o efeito real e nada além dele: o código atual para de
 * funcionar e um novo nasce na mesma operação. Não promete reimprimir, avisar
 * ninguém nem invalidar histórico — porque não faz nada disso.
 */
function RotateAction({ equipmentId }: { equipmentId: string }) {
  const [confirming, setConfirming] = useState(false);
  const rotate = useRotateEquipmentQr(equipmentId);

  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirming(true)}
        disabled={rotate.isPending}
      >
        <RefreshCw className="size-3.5" />
        Rotacionar QR
      </Button>
      <MutationError error={rotate.error} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(false);
        }}
        title="Rotacionar o QR do equipamento"
        body="A etiqueta atual deixa de funcionar e uma nova identidade é gerada na mesma operação. O equipamento e o histórico não mudam — só o código impresso precisa ser substituído."
        confirmLabel="Rotacionar"
        isPending={rotate.isPending}
        error={rotate.error}
        onConfirm={() =>
          rotate.mutate(undefined, { onSuccess: () => setConfirming(false) })
        }
      />
    </div>
  );
}
