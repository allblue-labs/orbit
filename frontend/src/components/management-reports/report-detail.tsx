"use client";

/**
 * Um relatório por inteiro.
 *
 * ## Duas coisas diferentes, separadas na tela
 *
 * **A geração** — quem pediu, quando, com que parâmetros — e **o snapshot** —
 * versão do formato, hash da fonte, procedências e os números. A separação é o
 * ponto: o relatório é uma fotografia, e uma fotografia tem data de captura
 * além do que aparece nela.
 *
 * ## Nada é recalculado aqui
 *
 * As seções são renderizadas **como vieram**. A tela não soma métricas, não
 * cruza domínios e não consulta o Analytics para "atualizar" um número antigo.
 * Se fizesse, o relatório de março passaria a mostrar setembro — e deixaria de
 * ser prova de qualquer coisa.
 *
 * ## Enquanto compõe
 *
 * O acompanhamento é por consulta curta, que para sozinha quando o servidor
 * termina. **Sem barra de progresso**: o backend publica quatro estados, não
 * porcentagem, e uma barra subindo seria um número inventado.
 */
import { useState } from "react";
import {
  Clock,
  Download,
  ExternalLink,
  Eye,
  Fingerprint,
  RotateCw,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAction } from "@/actions";
import {
  useManagementReport,
  useReportSignedUrl,
} from "@/hooks/management-reports/use-management-reports";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { isInFlight, type ManagementReport } from "@/types/management-reports";
import {
  ReportStatusBadge,
  SectionBlock,
  SourcesPanel,
} from "./report-presentation";

export function ReportDetail({
  reportId,
  onRepeat,
}: {
  reportId: string;
  onRepeat?: (report: ManagementReport) => void;
}) {
  const report = useManagementReport(reportId);

  if (report.isPending) {
    return (
      <PanelFrame
        panelId="report-detail-loading"
        title="Relatório"
        description="Carregando"
      >
        <PanelLoading rows={6} />
      </PanelFrame>
    );
  }

  if (report.error) {
    return (
      <PanelFrame
        panelId="report-detail-error"
        title="Relatório"
        description="Não foi possível abrir"
      >
        {/*
          403 aqui é caso previsto, não falha: um relatório financeiro exige
          `financial.read` além da capability do motor, e quem perdeu o acesso
          para de lê-lo — inclusive um que ele mesmo gerou. `PanelError` já
          distingue os dois.
        */}
        <PanelError error={report.error} onRetry={() => void report.refetch()} />
      </PanelFrame>
    );
  }

  const data = report.data;
  if (!data) return null;

  return (
    <div className="space-y-6">
      <GenerationPanel report={data} onRepeat={onRepeat} />

      {isInFlight(data.status) ? (
        <InFlightNotice status={data.status} />
      ) : data.status === "FAILED" ? (
        <FailedNotice report={data} />
      ) : (
        <>
          <SnapshotPanel report={data} />
          <FilePanel report={data} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* A geração                                                           */
/* ------------------------------------------------------------------ */

function GenerationPanel({
  report,
  onRepeat,
}: {
  report: ManagementReport;
  onRepeat?: (report: ManagementReport) => void;
}) {
  const repeat = useAction("management-report.repeat");

  return (
    <PanelFrame
      panelId="report-detail-generation"
      title={report.name}
      description="Os parâmetros que produziram este retrato."
      actions={
        onRepeat && repeat.allowed && !isInFlight(report.status) ? (
          <Button variant="outline" size="sm" onClick={() => onRepeat(report)}>
            <RotateCw className="size-4" />
            {repeat.label}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <ReportStatusBadge status={report.status} />
          <Badge variant="outline" className="border-border text-muted-foreground">
            {report.businessUnit?.name ?? "Toda a organização"}
          </Badge>
          <Badge variant="outline" className="border-border text-muted-foreground">
            {report.format}
          </Badge>
        </div>

        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field
            label="Período analisado"
            value={`${formatDate(report.period.from)} a ${formatDate(report.period.to)}`}
            hint={`Horários no fuso ${report.period.timezone}.`}
          />
          <Field
            label="Gerado por"
            value={report.generatedBy.displayName}
          />
          <Field
            label="Gerado em"
            value={
              report.generatedAt
                ? formatDateTime(report.generatedAt)
                : `solicitado em ${formatDateTime(report.createdAt)}`
            }
            hint="A data da captura — não é o período analisado."
          />
        </dl>
      </div>
    </PanelFrame>
  );
}

function Field({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
      {hint ? (
        <p className="text-[0.7rem] text-muted-foreground/80">{hint}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* O snapshot                                                          */
/* ------------------------------------------------------------------ */

function SnapshotPanel({ report }: { report: ManagementReport }) {
  const snapshot = report.snapshot;

  if (!snapshot) {
    return (
      <PanelFrame
        panelId="report-detail-snapshot-missing"
        title="Conteúdo"
        description="Os números deste retrato"
      >
        <p className="text-sm text-muted-foreground">
          Este relatório não tem conteúdo gravado. É o que acontece quando a
          geração não chegou ao fim.
        </p>
      </PanelFrame>
    );
  }

  return (
    <>
      <PanelFrame
        panelId="report-detail-provenance"
        title="Procedência"
        description="De onde cada número veio — e o que ficou de fora."
      >
        <div className="space-y-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Versão do formato"
              value={`v${snapshot.schemaVersion}`}
              hint="Muda quando a estrutura do relatório muda. Um relatório antigo continua legível na versão em que nasceu."
            />
            <div className="space-y-1">
              <dt className="flex items-center gap-2 text-xs text-muted-foreground">
                <Fingerprint className="size-3.5" aria-hidden />
                Código de verificação
              </dt>
              <dd className="font-mono text-xs break-all">
                {report.sourceHash ?? "—"}
              </dd>
              <p className="text-[0.7rem] text-muted-foreground/80">
                Dois relatórios do mesmo recorte, sem mudança no operacional,
                recebem o mesmo código — é assim que se confere que nada mudou.
              </p>
            </div>
          </dl>

          <Separator />

          <SourcesPanel sources={snapshot.sources} />
        </div>
      </PanelFrame>

      <PanelFrame
        panelId="report-detail-sections"
        title="Números do período"
        description="Como estavam quando o relatório foi gerado. Nada aqui é recalculado ao abrir."
      >
        <div className="space-y-8">
          {snapshot.sections.map((section) => (
            <SectionBlock key={section.id} section={section} />
          ))}
        </div>
      </PanelFrame>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Estados                                                             */
/* ------------------------------------------------------------------ */

function InFlightNotice({ status }: { status: string }) {
  return (
    <PanelFrame
      panelId="report-detail-inflight"
      title="Compondo"
      description="A geração acontece em segundo plano"
    >
      <div className="flex items-start gap-3 rounded-lg border border-border p-3">
        <Clock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm">
            {status === "PENDING"
              ? "Na fila. A geração começa em instantes."
              : "O relatório está sendo gerado."}
          </p>
          <p className="text-xs text-muted-foreground">
            Esta tela se atualiza sozinha quando terminar — você pode continuar
            usando o Orbit.
          </p>
        </div>
      </div>
    </PanelFrame>
  );
}

function FailedNotice({ report }: { report: ManagementReport }) {
  return (
    <PanelFrame
      panelId="report-detail-failed"
      title="A geração falhou"
      description="Nenhum número foi gravado"
    >
      <div className="space-y-3">
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {report.error ?? "O motivo não foi informado."}
        </p>
        <p className="text-xs text-muted-foreground">
          Um relatório que falhou não tem conteúdo: ele não chegou a existir
          como retrato. Gerar de novo cria uma nova solicitação; esta permanece
          no histórico com o motivo.
        </p>
      </div>
    </PanelFrame>
  );
}

/* ------------------------------------------------------------------ */
/* O arquivo                                                           */
/* ------------------------------------------------------------------ */

/**
 * Preview e download.
 *
 * A URL é pedida ao backend e usada **como veio** — absoluta e assinada. O
 * cliente não conhece bucket nem chave, e a URL se renova antes de vencer
 * enquanto a tela estiver aberta (mesmo ciclo de vida do Document Center).
 */
function FilePanel({ report }: { report: ManagementReport }) {
  const [operation, setOperation] = useState<"preview" | "download">("preview");
  const signed = useReportSignedUrl(report.id, operation, report.hasFile);
  const download = useAction("management-report.download");

  if (!report.hasFile) {
    return (
      <PanelFrame
        panelId="report-detail-file-missing"
        title="Arquivo"
        description="Nenhum arquivo emitido"
      >
        <p className="text-sm text-muted-foreground">
          Este relatório não tem arquivo. Os números continuam disponíveis
          acima — o conteúdo é o relatório; o PDF é uma forma de levá-lo.
        </p>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      panelId="report-detail-file"
      title="Arquivo"
      description={`${report.format} no mesmo padrão visual dos documentos de campo.`}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={operation === "preview" ? "default" : "outline"}
            size="sm"
            onClick={() => setOperation("preview")}
          >
            <Eye className="size-4" />
            Visualizar
          </Button>

          {download.allowed && signed.data ? (
            <Button variant="outline" size="sm" asChild>
              {/*
                A URL é de outra origem: `download` no anchor é dica, e quem
                decide entre abrir e salvar é o cabeçalho que o backend assinou.
              */}
              <a
                href={signed.data.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOperation("download")}
              >
                <Download className="size-4" />
                Baixar
              </a>
            </Button>
          ) : null}

          {signed.data ? (
            <Button variant="ghost" size="sm" asChild>
              <a
                href={signed.data.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="size-4" />
                Abrir em nova aba
              </a>
            </Button>
          ) : null}
        </div>

        <MutationError error={signed.error} />

        {signed.isPending ? (
          <PanelLoading rows={4} />
        ) : signed.data ? (
          <div className="space-y-2">
            {/*
              `sandbox` sem `allow-scripts`: o conteúdo é do tenant e não roda
              na origem da aplicação — a mesma barreira do Document Center.
            */}
            <iframe
              src={signed.data.url}
              title={`Relatório ${report.name}`}
              className="h-[70vh] w-full rounded-lg border border-border bg-surface"
              sandbox=""
            />
            <p className="text-xs text-muted-foreground">
              Acesso temporário, renovado automaticamente enquanto esta tela
              estiver aberta — o atual vale até{" "}
              {formatDateTime(signed.data.expiresAt)}. O link é temporário e pessoal; o arquivo nunca é acessado diretamente.
            </p>
          </div>
        ) : null}
      </div>
    </PanelFrame>
  );
}
