"use client";

/**
 * As páginas Início, Equipamentos e Documentos da área do cliente na web, e as
 * fichas de atendimento e equipamento — o mesmo conteúdo do app.
 */
import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  CalendarCheck,
  ClipboardCheck,
  Download,
  FileCheck2,
  FileText,
  Hourglass,
  LifeBuoy,
  Loader2,

  Receipt,
  Search,
  Snowflake,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browserUrlFor } from "@/lib/backend-url";
import { errorCopy } from "@/lib/error-copy";
import { notifyError } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  portalDocumentAccess,
  usePortalAsset,
  usePortalAssets,
  usePortalDocuments,
  usePortalOperation,
  usePortalOperations,
  usePortalSession,
  usePortalSummary,
  type DocumentFilter,
} from "@/portal/portal-hooks";
import type {
  PortalAsset,
  PortalDocument,
  PortalOperation,
} from "@/portal/portal-types";
import { PORTAL_ROUTES } from "./portal-shell";
import {
  assetTone,
  civilDate,
  DateBlock,
  Facts,
  formatDate,
  formatDateTime,
  IconTile,
  PortalDrawer,
  ItemCard,
  ListSkeleton,
  Note,
  operationTone,
  Pill,
  SectionTitle,
  type PortalTone,
} from "./portal-ui";

/* ------------------------------------------------------------------ */
/* Início                                                              */
/* ------------------------------------------------------------------ */

export function PortalHome() {
  const me = usePortalSession().data;
  const summary = usePortalSummary();
  const operations = usePortalOperations();
  const [aberta, setAberta] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Olá,</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {me?.identity.displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Acompanhe seus equipamentos, atendimentos e documentos com{" "}
          {me?.organization.displayName}.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          href={PORTAL_ROUTES.equipment}
          label="Equipamentos"
          value={summary.data?.assets}
          icon={Snowflake}
        />
        <Metric
          href={PORTAL_ROUTES.documents}
          label="Documentos"
          value={summary.data?.availableDocuments}
          icon={FileText}
        />
        <Metric
          label="Visitas previstas"
          value={summary.data?.upcomingVisits}
          icon={CalendarCheck}
          tone={summary.data?.upcomingVisits ? "info" : "neutral"}
        />
      </div>

      <Link
        href={`${PORTAL_ROUTES.requests}?novo=1`}
        className="flex items-center gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10"
      >
        <IconTile icon={LifeBuoy} />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">Precisa de ajuda?</span>
          <span className="block text-sm text-muted-foreground">
            Abra um chamado: manutenção, problema num equipamento ou uma dúvida.
          </span>
        </span>
        <span className="hidden text-sm font-medium text-primary sm:block">
          Abrir chamado
        </span>
      </Link>

      <section className="space-y-3">
        <SectionTitle>Atendimentos</SectionTitle>
        {operations.error ? (
          <Note icon={AlertCircle}>{errorCopy(operations.error)}</Note>
        ) : !operations.data ? (
          <ListSkeleton rows={4} />
        ) : operations.data.data.length === 0 ? (
          <Note icon={CalendarCheck}>
            Nenhum atendimento ainda. Quando houver, ele aparece aqui com a data
            e o técnico.
          </Note>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {operations.data.data.map((operacao) => (
              <OperationCard
                key={operacao.id}
                operation={operacao}
                onOpen={() => setAberta(operacao.id)}
              />
            ))}
          </div>
        )}
      </section>

      <OperationSheet id={aberta} onClose={() => setAberta(null)} />
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  href,
  tone = "neutral",
}: {
  label: string;
  value: number | undefined;
  icon: typeof Snowflake;
  href?: string;
  tone?: PortalTone;
}) {
  const conteudo = (
    <>
      <IconTile icon={icon} tone={tone === "neutral" ? "info" : tone} />
      <span>
        <span className="block text-2xl font-semibold tabular-nums">
          {value ?? "—"}
        </span>
        <span className="block text-xs text-muted-foreground">{label}</span>
      </span>
    </>
  );
  const classes =
    "flex items-center gap-3 rounded-xl border border-border bg-card p-4 shadow-sm";
  return href ? (
    <Link href={href} className={cn(classes, "hover:border-primary/40")}>
      {conteudo}
    </Link>
  ) : (
    <div className={classes}>{conteudo}</div>
  );
}

function OperationCard({
  operation,
  onOpen,
}: {
  operation: PortalOperation;
  onOpen: () => void;
}) {
  const tom = operationTone(operation.status.code);
  return (
    <ItemCard
      onClick={onOpen}
      leading={
        operation.completedAt ?? operation.scheduledStart ? (
          <DateBlock iso={operation.completedAt ?? operation.scheduledStart} tone={tom} />
        ) : (
          <IconTile icon={Wrench} tone={tom === "neutral" ? "info" : tom} />
        )
      }
      title={operation.title}
      subtitle={[operation.type, operation.responsibleTechnician?.displayName]
        .filter(Boolean)
        .join(" · ")}
      meta={operation.assets.map((a) => a.displayName).join(", ") || operation.location}
      badges={
        <>
          <Pill tone={tom}>{operation.status.label}</Pill>
          {operation.documentAvailable ? (
            <Pill tone="info">Documento disponível</Pill>
          ) : null}
        </>
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Documentos                                                          */
/* ------------------------------------------------------------------ */

const DOC_FILTERS = [
  { code: undefined, label: "Todos" },
  { code: "service", label: "Atendimentos" },
  { code: "pmoc", label: "PMOC" },
  { code: "quote", label: "Orçamentos" },
  { code: "receipt", label: "Recibos" },
] as const;

const DOC_LOOK: Record<string, { icon: typeof FileText; tone: PortalTone }> = {
  service: { icon: ClipboardCheck, tone: "info" },
  pmoc: { icon: FileCheck2, tone: "success" },
  quote: { icon: FileText, tone: "warning" },
  receipt: { icon: Receipt, tone: "neutral" },
};

/** Baixa o documento por uma URL assinada pedida agora — ela vence em minutos. */
async function abrirDocumento(id: string) {
  try {
    const acesso = await portalDocumentAccess(id);
    window.open(browserUrlFor(acesso.url), "_blank", "noopener,noreferrer");
  } catch (error) {
    notifyError("Não foi possível abrir o documento.", errorCopy(error));
  }
}

export function DocumentCard({ document }: { document: PortalDocument }) {
  const [abrindo, setAbrindo] = useState(false);
  const look = DOC_LOOK[document.category] ?? DOC_LOOK.service!;
  const abrir = async () => {
    setAbrindo(true);
    await abrirDocumento(document.id);
    setAbrindo(false);
  };
  return (
    <ItemCard
      onClick={() => void abrir()}
      leading={<IconTile icon={look.icon} tone={look.tone} />}
      title={document.title || document.categoryLabel}
      subtitle={`${document.categoryLabel} · emitido em ${formatDate(document.issuedAt)}`}
      meta={document.code}
      trailing={
        <span className="flex size-9 items-center justify-center rounded-lg text-primary">
          {abrindo ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        </span>
      }
    />
  );
}

export function PortalDocuments() {
  const [categoria, setCategoria] = useState<string | undefined>(undefined);
  const documentos = usePortalDocuments({ category: categoria });
  return (
    <div className="space-y-6">
      <PageTitle
        title="Documentos"
        description="Relatórios de atendimento, PMOC, orçamentos e recibos emitidos para você."
      />
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {DOC_FILTERS.map((filtro) => (
          <button
            key={filtro.label}
            type="button"
            onClick={() => setCategoria(filtro.code)}
            className={cn(
              "shrink-0 rounded-full border px-4 py-1.5 text-sm font-medium transition-colors",
              categoria === filtro.code
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:text-foreground",
            )}
          >
            {filtro.label}
          </button>
        ))}
      </div>
      <DocumentList
        query={documentos}
        empty={
          categoria
            ? "Nenhum documento nesta categoria."
            : "Nenhum documento emitido ainda. Relatórios, recibos e orçamentos aparecem aqui assim que forem emitidos."
        }
      />
    </div>
  );
}

function DocumentList({
  query,
  empty,
  columns = 2,
}: {
  query: ReturnType<typeof usePortalDocuments>;
  empty: string;
  columns?: 1 | 2;
}) {
  if (query.error) return <Note icon={AlertCircle}>{errorCopy(query.error)}</Note>;
  if (!query.data) return <ListSkeleton rows={2} />;
  if (query.data.data.length === 0) return <Note icon={Hourglass}>{empty}</Note>;
  return (
    <div className={cn("grid gap-3", columns === 2 && "lg:grid-cols-2")}>
      {query.data.data.map((documento) => (
        <DocumentCard key={documento.id} document={documento} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Equipamentos                                                        */
/* ------------------------------------------------------------------ */

export function PortalEquipment() {
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [aberto, setAberto] = useState<PortalAsset | null>(null);
  const equipamentos = usePortalAssets(termo);
  return (
    <div className="space-y-6">
      <PageTitle
        title="Equipamentos"
        description="Os equipamentos de climatização cadastrados para você, com o histórico de cada um."
      />
      <form
        className="relative"
        onSubmit={(event) => {
          event.preventDefault();
          setTermo(busca.trim());
        }}
      >
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            if (!e.target.value) setTermo("");
          }}
          placeholder="Buscar por nome, identificação ou série"
          className="pl-9"
          aria-label="Buscar equipamento"
        />
      </form>
      {equipamentos.error ? (
        <Note icon={AlertCircle}>{errorCopy(equipamentos.error)}</Note>
      ) : !equipamentos.data ? (
        <ListSkeleton rows={3} />
      ) : equipamentos.data.data.length === 0 ? (
        <Note icon={Snowflake}>
          {termo
            ? "Nenhum equipamento encontrado com essa busca."
            : "Nenhum equipamento cadastrado para você ainda."}
        </Note>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {equipamentos.data.data.map((asset) => (
            <ItemCard
              key={asset.id}
              onClick={() => setAberto(asset)}
              leading={<IconTile icon={Snowflake} />}
              title={asset.displayName}
              subtitle={
                [asset.manufacturer, asset.model].filter(Boolean).join(" · ") ||
                assetCategory(asset.category)
              }
              meta={
                [asset.location, asset.identifier].filter(Boolean).join(" · ") || null
              }
              badges={<Pill tone={assetTone(asset.status.code)}>{asset.status.label}</Pill>}
            />
          ))}
        </div>
      )}
      <AssetSheet asset={aberto} onClose={() => setAberto(null)} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fichas                                                              */
/* ------------------------------------------------------------------ */

/** A categoria do equipamento como o cliente lê — o servidor publica o código. */
const CATEGORIAS: Record<string, string> = {
  equipment: "Equipamento",
  vehicle: "Veículo",
  tool: "Ferramenta",
  facility: "Instalação",
  other: "Outro",
};

/** Cobre o código ("EQUIPMENT") e o texto antigo da API ("Equipment"). */
export function assetCategory(code: string | null | undefined): string {
  if (!code) return "Equipamento";
  return CATEGORIAS[code.trim().toLowerCase()] ?? code;
}

export function OperationSheet({
  id,
  onClose,
}: {
  id: string | null;
  onClose: () => void;
}) {
  const detalhe = usePortalOperation(id);
  const documentos = usePortalDocuments({ operationId: id ?? undefined }, Boolean(id));
  const op = detalhe.data;
  return (
    <PortalDrawer
      open={Boolean(id)}
      onClose={onClose}
      /* A data em bloco quando existe; sem agendamento, o ícone do serviço. */
      leading={
        op && (op.completedAt ?? op.scheduledStart) ? (
          <DateBlock
            iso={op.completedAt ?? op.scheduledStart}
            tone={operationTone(op.status.code)}
          />
        ) : undefined
      }
      icon={Wrench}
      tone={op ? (operationTone(op.status.code) === "neutral" ? "info" : operationTone(op.status.code)) : "info"}
      eyebrow={op ? `${op.type} · ${op.code}` : "Carregando…"}
      title={op?.title ?? "Atendimento"}
      badges={
        op ? (
          <>
            <Pill tone={operationTone(op.status.code)}>{op.status.label}</Pill>
            {op.documentAvailable ? <Pill tone="info">Documento disponível</Pill> : null}
          </>
        ) : null
      }
    >
      {!op ? (
        detalhe.error ? (
          <Note icon={AlertCircle}>{errorCopy(detalhe.error)}</Note>
        ) : (
          <ListSkeleton rows={3} />
        )
      ) : (
        <>
          <Facts
            items={[
              ["Agendado para", op.scheduledStart ? formatDateTime(op.scheduledStart) : null],
              ["Iniciado em", op.startedAt ? formatDateTime(op.startedAt) : null],
              ["Concluído em", op.completedAt ? formatDateTime(op.completedAt) : null],
              ["Técnico responsável", op.responsibleTechnician?.displayName],
              ["Unidade", op.businessUnit.displayName],
              ["Local", op.location],
              ["Equipamentos", op.assets.map((a) => a.displayName).join("\n")],
            ]}
          />
          {op.description ? (
            <section className="space-y-2">
              <SectionTitle>O que foi feito</SectionTitle>
              <p className="whitespace-pre-line rounded-xl border border-border bg-card p-4 text-sm leading-relaxed shadow-sm">
                {op.description}
              </p>
            </section>
          ) : null}
          <section className="space-y-2">
            <SectionTitle>Documentos</SectionTitle>
            <DocumentList
              query={documentos}
              columns={1}
              empty={
                op.status.code === "completed"
                  ? "O documento deste atendimento ainda está sendo emitido."
                  : "O documento fica disponível quando o atendimento for concluído."
              }
            />
          </section>
          {op.timeline.length > 0 ? (
            <section className="space-y-2">
              <SectionTitle>Linha do tempo</SectionTitle>
              <ol className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm">
                {op.timeline.map((evento, indice) => (
                  <li key={evento.id} className="flex gap-3">
                    <span
                      className={cn(
                        "mt-1.5 size-2.5 shrink-0 rounded-full",
                        indice === 0 ? "bg-primary" : "bg-border",
                      )}
                    />
                    <span>
                      <span className="block text-sm">
                        {evento.description || evento.event}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDateTime(evento.occurredAt)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </PortalDrawer>
  );
}

function AssetSheet({
  asset,
  onClose,
}: {
  asset: PortalAsset | null;
  onClose: () => void;
}) {
  const completo = usePortalAsset(asset?.id ?? null).data;
  const atual = completo ?? asset;
  const historico = usePortalOperations(asset?.id);
  const documentos = usePortalDocuments(
    { assetId: asset?.id } satisfies DocumentFilter,
    Boolean(asset),
  );
  const [operacao, setOperacao] = useState<string | null>(null);
  return (
    <PortalDrawer
      open={Boolean(asset)}
      onClose={onClose}
      icon={Snowflake}
      tone={atual ? assetTone(atual.status.code) : "info"}
      eyebrow={
        [atual ? assetCategory(atual.category) : null, atual?.identifier]
          .filter(Boolean)
          .join(" · ") || "Equipamento"
      }
      title={atual?.displayName ?? "Equipamento"}
      badges={
        atual ? <Pill tone={assetTone(atual.status.code)}>{atual.status.label}</Pill> : null
      }
      footer={
        atual ? (
          <Button asChild className="w-full">
            <Link href={`${PORTAL_ROUTES.requests}?novo=1&equipamento=${atual.id}`}>
              <LifeBuoy className="size-4" />
              Abrir chamado sobre este equipamento
            </Link>
          </Button>
        ) : null
      }
    >
      {atual ? (
        <>
          <Facts
            items={[
              [
                "Fabricante e modelo",
                [atual.manufacturer, atual.model].filter(Boolean).join(" · ") || null,
              ],
              ["Número de série", atual.serialNumber],
              ["Identificação", atual.identifier],
              ["Local", atual.location],
              ["Instalado em", civilDate(atual.installedOn)],
              ["Garantia até", civilDate(atual.warrantyUntil)],
            ]}
          />
          <section className="space-y-2">
            <SectionTitle>Histórico de atendimentos</SectionTitle>
            {historico.isPending ? (
              <ListSkeleton rows={2} />
            ) : historico.data?.data.length ? (
              <div className="space-y-3">
                {historico.data.data.map((op) => (
                  <OperationCard key={op.id} operation={op} onOpen={() => setOperacao(op.id)} />
                ))}
              </div>
            ) : (
              <Note icon={Wrench}>Nenhum atendimento registrado para este equipamento.</Note>
            )}
          </section>
          <section className="space-y-2">
            <SectionTitle>Documentos</SectionTitle>
            <DocumentList
              query={documentos}
              columns={1}
              empty="Nenhum documento emitido para este equipamento."
            />
          </section>
        </>
      ) : null}
      <OperationSheet id={operacao} onClose={() => setOperacao(null)} />
    </PortalDrawer>
  );
}

export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

