"use client";

/**
 * Reports Center — relatórios **gerenciais**.
 *
 * ## O que esta área não é
 *
 * Não é o Document Center. Lá ficam os documentos **emitidos pelo Artifact
 * Engine**: um PMOC preenchido em campo, com revisão, hash de conteúdo e
 * possibilidade de revogação. Aqui ficam retratos agregados de períodos, que
 * não têm execução, não têm revisão e não são assinados por ninguém.
 *
 * Os dois produzem PDF, e é só isso que têm em comum — misturá-los faria a
 * central de documentos responder por algo que o Artifact Engine não emitiu.
 *
 * ## Dashboard × Relatório
 *
 * A diferença está escrita na tela, não só na documentação: o dashboard
 * responde "como está agora"; o relatório responde "como estava em março", e
 * continua respondendo isso em setembro. Um relatório não é o dashboard
 * exportado.
 *
 * ## Os emitidos e os modelos moram aqui
 *
 * Eram itens de menu num grupo "Documentos" cujos três membros descrevem o mesmo
 * ciclo: o documento emitido, o relatório do período e o modelo que gera os dois.
 * Quem ajusta um olha o outro na mesma sessão.
 *
 * A distinção entre relatório gerencial e documento emitido **continua** — está
 * escrita acima e nas abas. O que mudou é que as duas coisas se alcançam sem
 * trocar de página.
 *
 * ## Modelos mora aqui
 *
 * O modelo é o que define o documento que o relatório gera, e quem ajusta um
 * está olhando o outro na mesma sessão. Eram dois itens de menu no mesmo grupo
 * descrevendo as duas pontas do mesmo ciclo.
 *
 * A aba pede `artifact_templates.read` por conta própria. E herda o guard da
 * página — `reports.management.read` —, que é a consequência de morar aqui:
 * quem não alcança relatórios gerenciais deixa de alcançar os modelos por esta
 * porta. Hoje nenhum plano separa as duas; `/artefatos/:id` continua aberto a
 * quem tem só `artifact_templates.read`.
 *
 * ## Isolamento de falha
 *
 * Cada aba tem `TabBoundary` própria, e dentro delas catálogo, histórico e
 * detalhe são consultas independentes. Um relatório financeiro que responde
 * 403 — porque o ator não tem `financial.read` — não derruba o histórico nem o
 * catálogo: é o caso mais provável de erro nesta tela, e o mais fácil de
 * confundir com "quebrou".
 */
import { Suspense, useState } from "react";
import { ContentContainer } from "@/components/layout/page-primitives";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAction } from "@/actions";
import {
  useManagementReportCount,
  useManagementReports,
  useReportCatalog,
} from "@/hooks/management-reports/use-management-reports";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import type { ManagementReportSummary } from "@/types/management-reports";
import { MetricCard, TabBoundary } from "@/workspace";
import { formatDate, formatDateTime } from "@/lib/formatters";
import { PeriodSnapshot } from "./period-snapshot";
import { ReportGenerator } from "./report-generator";
import { ReportHistory } from "./report-history";
import { ReportStatusBadge } from "./report-presentation";
import { useRouter, useSearchParams } from "next/navigation";
import { TemplatesList } from "@/components/artifact-studio/templates-list";
import { DocumentCenter } from "@/components/documents/document-center";
import { REPORTS_SECTIONS } from "./sections";
import { useSectionFromUrl } from "@/hooks/use-section-from-url";
import { SECTION_PARAM } from "@/lib/section-navigation";

/**
 * `useSearchParams` exige um limite de Suspense: a leitura do parâmetro só
 * acontece no cliente. É como "gerar de novo" chega aqui com o tipo escolhido.
 */
export function ReportsWorkspace() {
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
  const router = useRouter();
  const params = useSearchParams();

  /**
   * `?tipo=` abre direto na geração, com o tipo pré-escolhido.
   *
   * É o retorno de "gerar de novo": o tipo vem do relatório antigo, o período
   * e o recorte são de quem está pedindo agora. Herdar tudo produziria uma
   * cópia que ninguém decidiu.
   */
  const requestedType = params.get("tipo") ?? undefined;

  const canRead = session.hasCapability("reports.management.read");
  const canManage = session.hasCapability("reports.management.manage");
  const create = useAction("management-report.create");

  const canTemplates = session.hasCapability("artifact_templates.read");

  /*
   * Os documentos emitidos pedem a capability deles.
   *
   * O grupo "Documentos" do menu tinha três itens que descrevem o mesmo ciclo: o
   * documento emitido, o relatório do período e o modelo que gera os dois. Os
   * modelos já eram aba daqui; agora os emitidos também, e o grupo deixou de
   * existir — o menu criava rolagem em tela full HD.
   *
   * ## Por que `artifact_executions.read`, e não `artifact_manifests.read`
   *
   * Porque é o que a rota exige. A aba lê `GET /issued-documents`, que une as
   * execuções do Artifact Engine com os relatórios gerenciais e cobra as duas
   * capacidades — quem pergunta recebe linhas das duas origens, e pedir só uma
   * entregaria linhas que a pessoa não deveria ver. A metade de relatórios já está
   * garantida: a página inteira exige `reports.management.read`.
   *
   * Com `artifact_manifests.read` aqui, alguém que tivesse essa e não a de
   * execuções veria a aba e receberia 403 ao abri-la — uma porta que existe e não
   * abre é pior que porta nenhuma.
   */
  const canDocuments = session.hasCapability("artifact_executions.read");

  /* Os apelidos são públicos: entram em link guardado e não mudam. */
  const sections = [
    REPORTS_SECTIONS.overview,
    REPORTS_SECTIONS.generate,
    REPORTS_SECTIONS.history,
    ...(canDocuments ? [REPORTS_SECTIONS.documents] : []),
    ...(canTemplates ? [REPORTS_SECTIONS.templates] : []),
  ];

  const section = useSectionFromUrl(sections);

  /*
   * `?tipo=` abre a geração sem `?secao=`.
   *
   * É o retorno de "gerar de novo", um link que já existe e que só carrega o
   * tipo. Exigir `?secao=gerar` junto quebraria esses links; então o tipo pedido
   * decide a aba quando ninguém pediu seção nenhuma.
   */
  const tab =
    requestedType && !params.get(SECTION_PARAM) ? "gerar" : section.current;
  const setTab = section.go;
  const [seedType, setSeedType] = useState<string | undefined>(requestedType);
  /** O recorte escolhido na Visão geral, quando veio de lá. */
  const [seedPeriod, setSeedPeriod] = useState<{ from: string; to: string }>();

  const catalog = useReportCatalog(canRead);

  if (!canRead) {
    return (
      <ContentContainer size="wide">
        <PanelFrame
          panelId="reports-denied"
          title="Relatórios gerenciais"
          description="Fotografias reproduzíveis de um período"
        >
          <p className="text-sm text-muted-foreground">
            Seu acesso não inclui relatórios gerenciais. Eles são concedidos
            separadamente: um relatório consolida operação, agenda, comercial,
            financeiro e estoque numa página só — e cada domínio ainda exige o
            próprio acesso.
          </p>
        </PanelFrame>
      </ContentContainer>
    );
  }

  const openReport = (report: { id: string }) =>
    router.push(`${ROUTES.managementReports}/${report.id}`);

  const repeat = (report: ManagementReportSummary) => {
    setSeedType(report.type);
    setTab("gerar");
  };

  return (
    <ContentContainer size="wide" className="space-y-6">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="visao-geral">Visão geral</TabsTrigger>
          <TabsTrigger value="gerar">Gerar relatório</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
          {canDocuments ? (
            <TabsTrigger value={REPORTS_SECTIONS.documents}>
              Documentos emitidos
            </TabsTrigger>
          ) : null}
          {canTemplates ? (
            <TabsTrigger value="modelos">Modelos</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="visao-geral">
          <TabBoundary id="reports-overview" label="a visão geral">
            <Overview
              canGenerate={canManage && create.allowed}
              onGenerate={(period) => {
                setSeedPeriod(period);
                setTab("gerar");
              }}
              onOpen={openReport}
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="gerar">
          <TabBoundary id="reports-generate" label="a geração">
            <ReportGenerator
              canManage={canManage}
              initialType={seedType}
              initialPeriod={seedPeriod}
              onGenerated={(id) =>
                router.push(`${ROUTES.managementReports}/${id}`)
              }
            />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="historico">
          <TabBoundary id="reports-history" label="o histórico">
            <ReportHistory
              catalog={catalog.data}
              onOpen={openReport}
              onRepeat={canManage ? repeat : undefined}
            />
          </TabBoundary>
        </TabsContent>

        {canDocuments ? (
          <TabsContent value={REPORTS_SECTIONS.documents}>
            {/* Só monta na aba ativa: a central lista manifestos e abre o
                conteúdo de um documento. Abrir Relatórios não deveria disparar
                essas consultas. */}
            {tab === REPORTS_SECTIONS.documents ? (
              <TabBoundary
                id="reports-documents"
                label="os documentos emitidos"
              >
                <DocumentCenter embedded />
              </TabBoundary>
            ) : null}
          </TabsContent>
        ) : null}

        {canTemplates ? (
          <TabsContent value="modelos">
            {/* Só monta na aba ativa: a lista carrega o catálogo de modelos, e
                abrir Relatórios não deveria disparar essa consulta. */}
            {tab === "modelos" ? (
              <TabBoundary id="reports-templates" label="os modelos">
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Os modelos que a sua operação pode emitir. Abra um para ver
                    como o documento sai.
                  </p>
                  <TemplatesList />
                </div>
              </TabBoundary>
            ) : null}
          </TabsContent>
        ) : null}
      </Tabs>
    </ContentContainer>
  );
}

/* ------------------------------------------------------------------ */
/* Visão geral                                                         */
/* ------------------------------------------------------------------ */

/**
 * Os números da própria área.
 *
 * **Todos vêm de `meta.total`** — uma consulta por recorte, com `limit: 1`.
 * Contar itens da página daria o total da página, e um indicador que muda
 * conforme a paginação é pior que indicador nenhum. É a mesma regra que vale
 * para o conteúdo dos relatórios: quem conta é o servidor.
 */
function Overview({
  canGenerate,
  onGenerate,
  onOpen,
}: {
  canGenerate: boolean;
  onGenerate: (period?: { from: string; to: string }) => void;
  onOpen: (report: { id: string }) => void;
}) {
  const total = useManagementReportCount({});
  const inFlight = useManagementReportCount({ status: "GENERATING" });
  const queued = useManagementReportCount({ status: "PENDING" });
  const ready = useManagementReportCount({ status: "READY" });
  const failed = useManagementReportCount({ status: "FAILED" });

  const recent = useManagementReports({ page: 1, limit: 5 });
  const catalog = useReportCatalog();

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          metricId="management_reports.total"
          value={total.total}
          isPending={total.isPending}
          failed={total.failed}
          showDescription
        />
        {/*
          "Em composição" soma dois recortes do servidor — `PENDING` e
          `GENERATING` —, e não linhas de página. São duas contagens
          autoritativas; o que a tela faz é apresentá-las como um número só,
          porque para quem espera é a mesma espera.
        */}
        <MetricCard
          metricId="management_reports.in_flight"
          value={
            inFlight.total === undefined || queued.total === undefined
              ? undefined
              : inFlight.total + queued.total
          }
          isPending={inFlight.isPending || queued.isPending}
          failed={inFlight.failed || queued.failed}
          showDescription
        />
        <MetricCard
          metricId="management_reports.ready"
          value={ready.total}
          isPending={ready.isPending}
          failed={ready.failed}
          showDescription
        />
        <MetricCard
          metricId="management_reports.failed"
          value={failed.total}
          isPending={failed.isPending}
          failed={failed.failed}
          showDescription
        />
      </div>

      {/*
       * Aqui havia um painel explicando a diferença entre dashboard e
       * relatório gerencial: dois cartões de texto, um link para o painel e
       * nenhum número. Documentação numa tela de trabalho — a distinção vale, e
       * o lugar dela é o comentário no topo deste arquivo.
       *
       * No lugar entrou a operação real do período, que é o que decide se vale
       * gerar o relatório e de qual recorte.
       */}
      <PeriodSnapshot onGenerate={canGenerate ? onGenerate : undefined} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PanelFrame
          panelId="reports-recent"
          title="Gerados recentemente"
          description="Os cinco últimos"
        >
          {recent.isPending ? (
            <PanelLoading rows={3} />
          ) : recent.error ? (
            <PanelError
              error={recent.error}
              onRetry={() => void recent.refetch()}
            />
          ) : (recent.data?.data.length ?? 0) === 0 ? (
            <p className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
              Nenhum relatório ainda.
            </p>
          ) : (
            <ul className="space-y-2">
              {recent.data?.data.map((report) => (
                <li key={report.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(report)}
                    className="w-full rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="truncate font-medium">
                        {report.name}
                      </span>
                      <ReportStatusBadge status={report.status} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDate(report.period.from)} a{" "}
                      {formatDate(report.period.to)} ·{" "}
                      {report.generatedAt
                        ? formatDateTime(report.generatedAt)
                        : "aguardando"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PanelFrame>

        <PanelFrame
          panelId="reports-available-types"
          title="Tipos disponíveis"
          description="Cada tipo, com o que exige"
        >
          {catalog.isPending ? (
            <PanelLoading rows={4} />
          ) : catalog.error ? (
            <PanelError
              error={catalog.error}
              onRetry={() => void catalog.refetch()}
            />
          ) : (
            <ul className="space-y-2">
              {catalog.data?.types.map((type) => (
                <li
                  key={type.type}
                  className="flex items-start justify-between gap-3 rounded-lg border border-border p-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{type.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {type.blockedReason ?? type.description}
                    </p>
                  </div>
                  {type.allowed ? null : (
                    <span className="shrink-0 text-xs text-warning">
                      sem acesso
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </PanelFrame>
      </div>
    </div>
  );
}
