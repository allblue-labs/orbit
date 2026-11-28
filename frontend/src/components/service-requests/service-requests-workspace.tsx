"use client";

/**
 * Recebimento e gestão dos chamados abertos pelos clientes.
 *
 * A fila mostra primeiro o que precisa de alguém: urgência em destaque,
 * cliente, quem cuida e há quanto tempo mexeram — e, no próprio cartão, os dois
 * caminhos mais comuns: abrir o atendimento ou montar o orçamento. A ficha faz
 * o resto — triar, atribuir, responder ao cliente, anotar internamente e mudar
 * a situação.
 *
 * Atendimento e orçamento nascem do chamado: cliente, equipamento, o pedido e
 * os detalhes que o cliente deu vão preenchidos (`service-request-handoff`).
 *
 * Nenhuma regra de transição mora aqui: os botões são as `allowedActions` que
 * o servidor publica para cada chamado.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRightLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock,
  ExternalLink,
  FileText,
  LifeBuoy,
  Loader2,
  Lock,
  MapPin,
  MoreHorizontal,
  Phone,
  Play,
  Search,
  Send,
  User,
  UserCheck,
  Wrench,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Conversation } from "@/components/portal/portal-requests";
import {
  formatDate,
  formatDateTime,
  IconTile,
  Note,
  Pill,
  SectionTitle,
  type PortalTone,
} from "@/components/portal/portal-ui";
import { QuoteWizardDialog } from "@/components/quotes/wizard/quote-wizard.dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { EntityLink, entityHref } from "@/entities";
import {
  useServiceRequest,
  useServiceRequestCommand,
  useServiceRequests,
} from "@/hooks/customer-service-requests/use-customer-service-requests";
import { useBusinessUnits } from "@/hooks/organization/use-organization";
import { useTeamMembers } from "@/hooks/workforce/use-workforce";
import { errorCopy } from "@/lib/error-copy";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { requestTone, urgencyBadge } from "@/portal/service-request-model";
import { useSession } from "@/providers/session-provider";
import { customerServiceRequestsService as service } from "@/services/customer-service-requests.service";
import { quotesService } from "@/services/quotes.service";
import type {
  CustomerServiceRequestDetailsReadModel as ServiceRequest,
  CustomerServiceRequestListItemReadModel as ServiceRequestItem,
} from "@/types/contracts/modules/customer-service-requests/customer-service-request.read-models";
import {
  operationDescription,
  operationKind,
  quoteDraftFrom,
  quoteLinkNote,
  requestDetailLines,
  suggestedOperationCode,
} from "./service-request-handoff";

const FILTROS = [
  { code: undefined, label: "Todos" },
  { code: "OPEN", label: "Novos" },
  { code: "IN_TRIAGE", label: "Em triagem" },
  { code: "IN_PROGRESS", label: "Em atendimento" },
  { code: "WAITING_CUSTOMER", label: "Aguardando cliente" },
  { code: "RESOLVED", label: "Resolvidos" },
  { code: "REJECTED", label: "Recusados" },
  { code: "CANCELLED", label: "Cancelados" },
] as const;

const TIPOS_DE_ATENDIMENTO = [
  { code: "MAINTENANCE", label: "Manutenção" },
  { code: "INSTALLATION", label: "Instalação" },
  { code: "INSPECTION", label: "Vistoria" },
  { code: "DELIVERY", label: "Entrega" },
  { code: "OTHER", label: "Outro" },
] as const;

/** Chamados que já terminaram não pedem orçamento novo. */
const FECHADOS = new Set(["RESOLVED", "REJECTED", "CANCELLED"]);

const urgencyTone = (code: string): PortalTone =>
  code === "URGENT" ? "danger" : code === "HIGH" ? "warning" : "neutral";

const categoryIcon = (code: string): LucideIcon =>
  code === "EQUIPMENT_PROBLEM" || code === "MAINTENANCE"
    ? Wrench
    : code === "DOCUMENT_REQUEST"
      ? FileText
      : LifeBuoy;

/** O que está sendo feito a partir de um chamado: atendimento ou orçamento. */
type Handoff = { kind: "operation" | "quote"; id: string } | null;

export function ServiceRequestsWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const session = useSession();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [handoff, setHandoff] = useState<Handoff>(null);
  const aberto = params.get("chamado");
  const podeOrcar = session.hasPermission("quotes.manage");
  const chamados = useServiceRequests({
    status,
    search: termo || undefined,
    limit: 50,
  });

  const abrir = (id: string | null) =>
    router.replace(
      id ? `${ROUTES.serviceRequests}?chamado=${id}` : ROUTES.serviceRequests,
      { scroll: false },
    );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1 pb-1">
          {FILTROS.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={() => setStatus(f.code)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                status === f.code
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <form
          className="relative w-full sm:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            setTermo(busca.trim());
          }}
        >
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              if (!e.target.value) setTermo("");
            }}
            placeholder="Código, assunto ou cliente"
            className="pl-9"
            aria-label="Buscar chamado"
          />
        </form>
      </div>

      {chamados.error ? (
        <Note icon={LifeBuoy}>{errorCopy(chamados.error)}</Note>
      ) : !chamados.data ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : chamados.data.data.length === 0 ? (
        <Note icon={LifeBuoy}>
          {status || termo
            ? "Nenhum chamado com esse filtro."
            : "Nenhum chamado ainda. Quando um cliente abrir um chamado pelo portal ou pelo app, ele aparece aqui."}
        </Note>
      ) : (
        <ul className="space-y-3">
          {chamados.data.data.map((r) => (
            <RequestCard
              key={r.id}
              request={r}
              canQuote={podeOrcar}
              onOpen={() => abrir(r.id)}
              onOperation={() => setHandoff({ kind: "operation", id: r.id })}
              onQuote={() => setHandoff({ kind: "quote", id: r.id })}
            />
          ))}
        </ul>
      )}

      <RequestSheet
        id={aberto}
        canQuote={podeOrcar}
        onClose={() => abrir(null)}
        onHandoff={setHandoff}
        key={aberto ?? "fechado"}
      />

      {handoff?.kind === "operation" ? (
        <ConvertDialog id={handoff.id} onClose={() => setHandoff(null)} />
      ) : handoff?.kind === "quote" ? (
        <QuoteFromRequest id={handoff.id} onClose={() => setHandoff(null)} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fila                                                                */
/* ------------------------------------------------------------------ */

function RequestCard({
  request: r,
  canQuote,
  onOpen,
  onOperation,
  onQuote,
}: {
  request: ServiceRequestItem;
  canQuote: boolean;
  onOpen: () => void;
  onOperation: () => void;
  onQuote: () => void;
}) {
  const atender = r.allowedActions.includes("CREATE_OPERATION");
  const orcar = canQuote && !FECHADOS.has(r.status.code);
  const Icone = categoryIcon(r.category.code);
  return (
    <li className="group rounded-xl border border-border bg-card shadow-sm transition-colors hover:border-primary/40">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-3 rounded-lg text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <IconTile icon={Icone} tone={urgencyTone(r.urgency.code) === "neutral" ? "info" : urgencyTone(r.urgency.code)} />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">{r.code}</span>
              <Pill tone={requestTone(r.status.code)}>{r.status.label}</Pill>
              {["URGENT", "HIGH"].includes(r.urgency.code) ? (
                <Pill tone={urgencyTone(r.urgency.code)}>
                  {urgencyBadge(r.urgency.code, r.urgency.label)}
                </Pill>
              ) : null}
            </span>
            <span className="line-clamp-2 block leading-snug font-medium">{r.subject}</span>
            <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Building2 className="size-3.5" aria-hidden />
                {r.customerName ?? "Cliente"}
              </span>
              {r.asset ? (
                <span className="inline-flex items-center gap-1">
                  <Wrench className="size-3.5" aria-hidden />
                  {r.asset.name}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <User className="size-3.5" aria-hidden />
                {r.assignedTo?.displayName ?? "Sem responsável"}
              </span>
              <span className="inline-flex items-center gap-1 tabular-nums">
                <CalendarClock className="size-3.5" aria-hidden />
                {formatDate(r.updatedAt)}
              </span>
            </span>
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
          {atender ? (
            <Button size="sm" onClick={onOperation}>
              <ArrowRightLeft className="size-4" />
              Abrir atendimento
            </Button>
          ) : null}
          {orcar ? (
            <Button size="sm" variant="outline" onClick={onQuote}>
              <FileText className="size-4" />
              Orçamento
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpen}
            aria-label={`Ver o chamado ${r.code}`}
          >
            Ver
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Ficha                                                               */
/* ------------------------------------------------------------------ */

function RequestSheet({
  id,
  canQuote,
  onClose,
  onHandoff,
}: {
  id: string | null;
  canQuote: boolean;
  onClose: () => void;
  onHandoff: (handoff: Handoff) => void;
}) {
  const detalhe = useServiceRequest(id);
  const comando = useServiceRequestCommand();
  const membros = useTeamMembers();
  const [mensagem, setMensagem] = useState("");
  const [interna, setInterna] = useState(false);
  const r = detalhe.data;
  const pode = (acao: string) => r?.allowedActions.includes(acao as never) ?? false;

  const executar = (run: () => Promise<ServiceRequest>, depois?: () => void) =>
    comando.mutate(run, { onSuccess: () => depois?.() });

  const mudancas =
    r &&
    (pode("TRIAGE") || pode("MARK_IN_PROGRESS") || pode("RESOLVE") || pode("REJECT"));

  return (
    <Sheet open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-2xl">
        {/* Cabeçalho: o que é, em que pé está, de quem veio. */}
        <SheetHeader className="space-y-3 border-b border-border bg-card px-6 pt-6 pb-4 text-left">
          <div className="flex items-start gap-3 pr-6">
            <IconTile
              icon={r ? categoryIcon(r.category.code) : LifeBuoy}
              tone={r && urgencyTone(r.urgency.code) !== "neutral" ? urgencyTone(r.urgency.code) : "info"}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <SheetDescription className="text-xs font-semibold tracking-wider uppercase">
                {r ? `${r.category.label} · ${r.code}` : "Carregando…"}
              </SheetDescription>
              <SheetTitle className="text-lg leading-snug">
                {r?.subject ?? "Chamado"}
              </SheetTitle>
            </div>
          </div>
          {r ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={requestTone(r.status.code)}>{r.status.label}</Pill>
              <Pill tone={urgencyTone(r.urgency.code)}>
                {urgencyBadge(r.urgency.code, r.urgency.label)}
              </Pill>
              <span className="text-xs text-muted-foreground">
                Aberto em {formatDateTime(r.submittedAt)}
                {r.requester ? ` por ${r.requester}` : ""}
              </span>
            </div>
          ) : null}

          {/* As ações que movem o chamado ficam à mão, não no fim da ficha. */}
          {r ? (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {r.convertedOperation ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={`${ROUTES.operations}/${r.convertedOperation.id}`}>
                    <CheckCircle2 className="size-4 text-emerald-600" />
                    Atendimento {r.convertedOperation.code}
                    <ExternalLink className="size-3.5" />
                  </Link>
                </Button>
              ) : pode("CREATE_OPERATION") ? (
                <Button size="sm" onClick={() => onHandoff({ kind: "operation", id: r.id })}>
                  <ArrowRightLeft className="size-4" />
                  Abrir atendimento
                </Button>
              ) : null}
              {canQuote && !FECHADOS.has(r.status.code) ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onHandoff({ kind: "quote", id: r.id })}
                >
                  <FileText className="size-4" />
                  Criar orçamento
                </Button>
              ) : null}
              {mudancas ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="ghost" disabled={comando.isPending}>
                      <MoreHorizontal className="size-4" />
                      Mais ações
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    {pode("TRIAGE") ? (
                      <DropdownMenuItem onSelect={() => executar(() => service.triage(r.id, r.version))}>
                        <Clock className="size-4" /> Iniciar triagem
                      </DropdownMenuItem>
                    ) : null}
                    {pode("MARK_IN_PROGRESS") ? (
                      <DropdownMenuItem
                        onSelect={() => executar(() => service.status(r.id, r.version, "IN_PROGRESS"))}
                      >
                        <Play className="size-4" /> Marcar em atendimento
                      </DropdownMenuItem>
                    ) : null}
                    {pode("RESOLVE") ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          executar(
                            () => service.status(r.id, r.version, "RESOLVED", mensagem.trim() || undefined),
                            () => setMensagem(""),
                          )
                        }
                      >
                        <CheckCircle2 className="size-4" /> Resolver
                      </DropdownMenuItem>
                    ) : null}
                    {pode("REJECT") ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onSelect={() =>
                            executar(
                              () => service.status(r.id, r.version, "REJECTED", mensagem.trim() || undefined),
                              () => setMensagem(""),
                            )
                          }
                        >
                          <XCircle className="size-4" /> Recusar chamado
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
        </SheetHeader>

        <div className="flex-1 space-y-6 overflow-y-auto bg-muted/30 px-6 py-5">
          {!r ? (
            detalhe.error ? (
              <Note icon={LifeBuoy}>{errorCopy(detalhe.error)}</Note>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-24 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
              </div>
            )
          ) : (
            <>
              <MutationError error={comando.error} />

              <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard icon={Building2} label="Cliente">
                  <EntityLink entity="customer" id={r.customer.id}>
                    {r.customer.name}
                  </EntityLink>
                </SummaryCard>
                <SummaryCard icon={Wrench} label="Equipamento">
                  {r.asset
                    ? [r.asset.name, r.asset.identifier].filter(Boolean).join(" · ")
                    : "Não informado"}
                </SummaryCard>
                <SummaryCard icon={UserCheck} label="Responsável">
                  {pode("ASSIGN") ? (
                    <Select
                      value={r.assignedTo?.id ?? ""}
                      onValueChange={(userId) => executar(() => service.assign(r.id, r.version, userId))}
                    >
                      <SelectTrigger className="mt-1 h-8 w-full">
                        <SelectValue placeholder="Definir responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        {(membros.data?.data ?? []).map((m) => (
                          <SelectItem key={m.userId} value={m.userId}>
                            {m.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    (r.assignedTo?.displayName ?? "Ninguém ainda")
                  )}
                </SummaryCard>
                <SummaryCard icon={MapPin} label="Unidade">
                  {r.businessUnit?.name ?? "Definida ao abrir o atendimento"}
                </SummaryCard>
              </div>

              <section className="space-y-2">
                <SectionTitle>O que o cliente pediu</SectionTitle>
                <p className="rounded-xl border border-border bg-card p-4 text-sm leading-relaxed whitespace-pre-line shadow-sm">
                  {r.description}
                </p>
              </section>

              <DetailsForTechnician request={r} />

              <section className="space-y-3">
                <SectionTitle>Conversa</SectionTitle>
                <Conversation request={r} internal />
              </section>

              {pode("ADD_PUBLIC_RESPONSE") || pode("ADD_INTERNAL_NOTE") ? (
                <form
                  className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const texto = mensagem.trim();
                    if (!texto) return;
                    executar(
                      () =>
                        interna
                          ? service.internalNote(r.id, r.version, texto)
                          : service.publicResponse(r.id, r.version, texto),
                      () => setMensagem(""),
                    );
                  }}
                >
                  <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
                    <button
                      type="button"
                      onClick={() => setInterna(false)}
                      className={cn(
                        "flex-1 rounded-md px-3 py-1.5",
                        !interna && "bg-background font-medium shadow-sm",
                      )}
                    >
                      Responder ao cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => setInterna(true)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5",
                        interna && "bg-background font-medium shadow-sm",
                      )}
                    >
                      <Lock className="size-3.5" /> Nota interna
                    </button>
                  </div>
                  <Textarea
                    rows={3}
                    maxLength={4000}
                    value={mensagem}
                    onChange={(e) => setMensagem(e.target.value)}
                    placeholder={
                      interna
                        ? "Só a equipe vê esta nota."
                        : "O cliente vê esta mensagem no portal e no app."
                    }
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button type="submit" size="sm" disabled={comando.isPending || !mensagem.trim()}>
                      {comando.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      {interna ? "Salvar nota" : "Enviar ao cliente"}
                    </Button>
                    {!interna && pode("WAIT_FOR_CUSTOMER") ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={comando.isPending || !mensagem.trim()}
                        onClick={() =>
                          executar(
                            () => service.status(r.id, r.version, "WAITING_CUSTOMER", mensagem.trim()),
                            () => setMensagem(""),
                          )
                        }
                      >
                        Perguntar e aguardar o cliente
                      </Button>
                    ) : null}
                  </div>
                  {pode("RESOLVE") || pode("REJECT") ? (
                    <p className="text-xs text-muted-foreground">
                      Resolver ou recusar em “Mais ações” envia junto a mensagem escrita aqui.
                    </p>
                  ) : null}
                </form>
              ) : null}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-sm">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="truncate text-sm font-medium">{children}</div>
      </div>
    </div>
  );
}

/** O que o cliente contou sobre o local e o equipamento — o técnico lê isto. */
function DetailsForTechnician({ request: r }: { request: ServiceRequest }) {
  const d = r.details;
  const itens: [LucideIcon, string, string | null | undefined][] = [
    [Wrench, "Situação do equipamento", d.equipmentCondition?.label],
    [MapPin, "Onde fica", d.siteLocation],
    [CalendarClock, "Melhor horário", d.availability],
    [User, "Quem recebe o técnico", d.contactName],
    [Phone, "Telefone", d.contactPhone],
  ];
  const visiveis = itens.filter(([, , valor]) => valor && valor.trim());
  return (
    <section className="space-y-2">
      <SectionTitle>Detalhes para o técnico</SectionTitle>
      {visiveis.length === 0 ? (
        <Note icon={LifeBuoy}>O cliente não deixou detalhes de local ou horário.</Note>
      ) : (
        <dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border shadow-sm sm:grid-cols-2">
          {visiveis.map(([Icon, rotulo, valor]) => (
            <div key={rotulo} className="flex items-start gap-2.5 bg-card p-3">
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <dt className="text-xs text-muted-foreground">{rotulo}</dt>
                <dd className="text-sm whitespace-pre-line">{valor}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Atendimento                                                          */
/* ------------------------------------------------------------------ */

/** O que foi extraído do chamado, à vista antes de confirmar. */
function Extracted({ request }: { request: ServiceRequest }) {
  const linhas = requestDetailLines(request);
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-sm">
      <p className="text-xs font-semibold tracking-wider text-primary uppercase">
        Vem do chamado {request.code}
      </p>
      <p>
        <span className="text-muted-foreground">Cliente:</span> {request.customer.name}
      </p>
      {linhas.map((linha) => {
        const [rotulo, ...resto] = linha.split(": ");
        return (
          <p key={linha}>
            <span className="text-muted-foreground">{rotulo}:</span> {resto.join(": ")}
          </p>
        );
      })}
      <p className="line-clamp-3 text-muted-foreground">“{request.description}”</p>
    </div>
  );
}

/** Cria o atendimento a partir do chamado — tudo pré-preenchido. */
function ConvertDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const detalhe = useServiceRequest(id);
  const request = detalhe.data;
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Abrir atendimento</DialogTitle>
          <DialogDescription>
            O chamado vira um atendimento com o cliente, o equipamento e os detalhes já preenchidos. O
            cliente acompanha pelo portal.
          </DialogDescription>
        </DialogHeader>
        {request ? (
          <ConvertForm request={request} onClose={onClose} />
        ) : detalhe.error ? (
          <Note icon={LifeBuoy}>{errorCopy(detalhe.error)}</Note>
        ) : (
          <Skeleton className="h-48 w-full rounded-lg" />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConvertForm({ request, onClose }: { request: ServiceRequest; onClose: () => void }) {
  const router = useRouter();
  const unidades = useBusinessUnits();
  const comando = useServiceRequestCommand();
  const chave = useMemo(() => `web-convert-${crypto.randomUUID()}`, []);
  const [unidade, setUnidade] = useState(request.businessUnit?.id ?? "");
  const [codigo, setCodigo] = useState(() => suggestedOperationCode());
  const [tipo, setTipo] = useState(() => operationKind(request));
  const [titulo, setTitulo] = useState(request.subject);
  const lista = unidades.data ?? [];
  const unidadeEfetiva = unidade || (lista.length === 1 ? lista[0]!.id : "");

  if (request.convertedOperation) {
    return (
      <div className="space-y-3">
        <Note icon={CheckCircle2}>
          Este chamado já virou o atendimento {request.convertedOperation.code}.
        </Note>
        <Button asChild className="w-full">
          <Link href={`${ROUTES.operations}/${request.convertedOperation.id}`}>
            Abrir o atendimento
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Extracted request={request} />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label>Unidade</Label>
          <Select value={unidadeEfetiva} onValueChange={setUnidade} disabled={Boolean(request.businessUnit)}>
            <SelectTrigger>
              <SelectValue placeholder="Escolha a unidade" />
            </SelectTrigger>
            <SelectContent>
              {lista.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.tradeName ?? u.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {request.businessUnit ? (
            <p className="text-xs text-muted-foreground">A unidade do equipamento do chamado.</p>
          ) : null}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cv-code">Código</Label>
            <Input id="cv-code" value={codigo} maxLength={60} onChange={(e) => setCodigo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DE_ATENDIMENTO.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cv-title">Título</Label>
          <Input id="cv-title" value={titulo} maxLength={180} onChange={(e) => setTitulo(e.target.value)} />
        </div>
        <MutationError error={comando.error} />
      </div>
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onClose} disabled={comando.isPending}>
          Cancelar
        </Button>
        <Button
          disabled={
            comando.isPending ||
            !unidadeEfetiva ||
            codigo.trim().length < 2 ||
            titulo.trim().length < 2
          }
          onClick={() =>
            comando.mutate(
              () =>
                service.convert(request.id, chave, {
                  expectedVersion: request.version,
                  businessUnitId: unidadeEfetiva,
                  code: codigo.trim(),
                  kind: tipo,
                  title: titulo.trim(),
                  description: operationDescription(request),
                }),
              {
                onSuccess: (atualizado) => {
                  onClose();
                  const op = atualizado.convertedOperation;
                  if (!op) return;
                  toast.success(`Atendimento ${op.code} aberto`, {
                    description: "Agende e atribua a equipe na página do atendimento.",
                    action: {
                      label: "Abrir",
                      onClick: () => router.push(`${ROUTES.operations}/${op.id}`),
                    },
                  });
                },
              },
            )
          }
        >
          {comando.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <ArrowRightLeft className="size-4" />
          )}
          Abrir atendimento
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orçamento                                                            */
/* ------------------------------------------------------------------ */

/**
 * O assistente de orçamento, aberto com o que o chamado já sabe.
 *
 * Gerado o orçamento, o chamado recebe uma nota interna com o código — quem
 * abrir a ficha depois sabe que já existe proposta, e qual.
 */
function QuoteFromRequest({ id, onClose }: { id: string; onClose: () => void }) {
  const router = useRouter();
  const client = useQueryClient();
  const detalhe = useServiceRequest(id);
  const request = detalhe.data;

  if (!request) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo orçamento</DialogTitle>
            <DialogDescription>Lendo o chamado…</DialogDescription>
          </DialogHeader>
          {detalhe.error ? (
            <Note icon={LifeBuoy}>{errorCopy(detalhe.error)}</Note>
          ) : (
            <Skeleton className="h-24 w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>
    );
  }

  const registrar = async (quoteId: string) => {
    const href = entityHref("quote", quoteId);
    try {
      const [quote, atual] = await Promise.all([
        quotesService.get(quoteId),
        service.get(request.id),
      ]);
      if (atual.allowedActions.includes("ADD_INTERNAL_NOTE")) {
        const anotado = await service.internalNote(atual.id, atual.version, quoteLinkNote(quote));
        client.setQueryData(service.keys.detail(anotado.id), anotado);
      }
      await client.invalidateQueries({ queryKey: service.keys.all() });
      toast.success(`Orçamento ${quote.code} criado`, {
        description: `Ligado ao chamado ${request.code}.`,
      });
    } catch {
      /* O orçamento existe; só a nota no chamado falhou. Não some com ele. */
      toast.warning("Orçamento criado", {
        description: `Não foi possível anotar no chamado ${request.code}.`,
      });
    }
    if (href) router.push(href);
  };

  return (
    <QuoteWizardDialog
      open
      onOpenChange={(v) => !v && onClose()}
      customerId={request.customer.id}
      initial={quoteDraftFrom(request)}
      startAt="dados"
      context={
        <p className="flex items-start gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <FileText className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
          <span>
            Cliente, equipamento, título e objeto vieram do chamado{" "}
            <strong className="text-foreground">{request.code}</strong>. Ajuste o que precisar e
            inclua os serviços e materiais.
          </span>
        </p>
      }
      onCreated={(quoteId) => {
        onClose();
        void registrar(quoteId);
      }}
    />
  );
}
