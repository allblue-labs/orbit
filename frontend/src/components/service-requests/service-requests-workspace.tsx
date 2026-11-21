"use client";

/**
 * Recebimento e gestão dos chamados abertos pelos clientes.
 *
 * A fila mostra primeiro o que precisa de alguém: urgência em destaque,
 * cliente, quem cuida e há quanto tempo mexeram. A ficha faz o resto — triar,
 * atribuir, responder ao cliente, anotar internamente, mudar a situação e
 * transformar o chamado em atendimento.
 *
 * Nenhuma regra de transição mora aqui: os botões são as `allowedActions` que
 * o servidor publica para cada chamado.
 */
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import {
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  ExternalLink,
  LifeBuoy,
  Loader2,
  Lock,
  Play,
  Search,
  Send,
  UserCheck,
  XCircle,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Conversation } from "@/components/portal/portal-requests";
import {
  Facts,
  formatDate,
  formatDateTime,
  Note,
  Pill,
  SectionTitle,
  type PortalTone,
} from "@/components/portal/portal-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { EntityLink } from "@/entities";
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
import { customerServiceRequestsService as service } from "@/services/customer-service-requests.service";
import type { CustomerServiceRequestDetailsReadModel as ServiceRequest } from "@/types/contracts/modules/customer-service-requests/customer-service-request.read-models";

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

const urgencyTone = (code: string): PortalTone =>
  code === "URGENT" ? "danger" : code === "HIGH" ? "warning" : "neutral";

export function ServiceRequestsWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const aberto = params.get("chamado");
  const chamados = useServiceRequests({
    status,
    search: termo || undefined,
    limit: 50,
  });

  const abrir = (id: string | null) =>
    router.replace(id ? `${ROUTES.serviceRequests}?chamado=${id}` : ROUTES.serviceRequests, {
      scroll: false,
    });

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
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
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
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : chamados.data.data.length === 0 ? (
        <Note icon={LifeBuoy}>
          {status || termo
            ? "Nenhum chamado com esse filtro."
            : "Nenhum chamado ainda. Quando um cliente abrir um chamado pelo portal ou pelo app, ele aparece aqui."}
        </Note>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {chamados.data.data.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => abrir(r.id)}
                className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/50"
              >
                <span className="min-w-0 flex-1 basis-64">
                  <span className="flex items-center gap-2">
                    {["URGENT", "HIGH"].includes(r.urgency.code) ? (
                      <Pill tone={urgencyTone(r.urgency.code)}>
                        {urgencyBadge(r.urgency.code, r.urgency.label)}
                      </Pill>
                    ) : null}
                    <span className="truncate font-medium">{r.subject}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {r.code} · {r.customerName ?? "Cliente"} · {r.category.label}
                    {r.asset ? ` · ${r.asset.name}` : ""}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {r.assignedTo?.displayName ?? "Sem responsável"}
                </span>
                <span className="w-24 text-xs text-muted-foreground tabular-nums">
                  {formatDate(r.updatedAt)}
                </span>
                <Pill tone={requestTone(r.status.code)}>{r.status.label}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}

      <RequestSheet id={aberto} onClose={() => abrir(null)} key={aberto ?? "fechado"} />
    </div>
  );
}

function RequestSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const detalhe = useServiceRequest(id);
  const comando = useServiceRequestCommand();
  const membros = useTeamMembers();
  const [mensagem, setMensagem] = useState("");
  const [interna, setInterna] = useState(false);
  const [convertendo, setConvertendo] = useState(false);
  const r = detalhe.data;
  const pode = (acao: string) => r?.allowedActions.includes(acao as never) ?? false;

  const executar = (run: () => Promise<ServiceRequest>, depois?: () => void) =>
    comando.mutate(run, { onSuccess: () => depois?.() });

  return (
    <Sheet open={Boolean(id)} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full overflow-y-auto bg-muted/30 sm:max-w-2xl">
        <SheetHeader className="space-y-1 text-left">
          <SheetDescription className="text-xs font-semibold uppercase tracking-wider">
            {r ? `${r.category.label} · ${r.code}` : "Carregando…"}
          </SheetDescription>
          <SheetTitle className="text-lg leading-snug">{r?.subject ?? "Chamado"}</SheetTitle>
        </SheetHeader>
        <div className="space-y-6 px-4 pb-10">
          {!r ? (
            detalhe.error ? (
              <Note icon={LifeBuoy}>{errorCopy(detalhe.error)}</Note>
            ) : (
              <Skeleton className="h-40 w-full rounded-xl" />
            )
          ) : (
            <>
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

              {r.convertedOperation ? (
                <Link
                  href={`${ROUTES.operations}/${r.convertedOperation.id}`}
                  className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300"
                >
                  <CheckCircle2 className="size-4" />
                  Virou o atendimento {r.convertedOperation.code}
                  <ExternalLink className="ml-auto size-4" />
                </Link>
              ) : null}

              <section className="space-y-2">
                <SectionTitle>O que o cliente pediu</SectionTitle>
                <p className="whitespace-pre-line rounded-xl border border-border bg-card p-4 text-sm">
                  {r.description}
                </p>
              </section>

              <section className="space-y-2">
                <SectionTitle>Para o atendimento</SectionTitle>
                <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
                  <span className="text-xs text-muted-foreground">Cliente</span>
                  <div>
                    <EntityLink entity="customer" id={r.customer.id}>
                      {r.customer.name}
                    </EntityLink>
                  </div>
                </div>
                <Facts
                  items={[
                    ["Equipamento", r.asset ? [r.asset.name, r.asset.identifier].filter(Boolean).join(" · ") : null],
                    ["Situação do equipamento", r.details.equipmentCondition?.label],
                    ["Onde fica", r.details.siteLocation],
                    ["Melhor horário", r.details.availability],
                    ["Quem recebe o técnico", r.details.contactName],
                    ["Telefone", r.details.contactPhone],
                    ["Unidade", r.businessUnit?.name],
                    ["Responsável", r.assignedTo?.displayName],
                  ]}
                />
              </section>

              {pode("TRIAGE") || pode("MARK_IN_PROGRESS") || pode("WAIT_FOR_CUSTOMER") || pode("RESOLVE") || pode("REJECT") || pode("ASSIGN") || pode("CREATE_OPERATION") ? (
                <section className="space-y-3">
                  <SectionTitle>Ações</SectionTitle>
                  <div className="flex flex-wrap gap-2">
                    {pode("TRIAGE") ? (
                      <Button size="sm" variant="outline" disabled={comando.isPending} onClick={() => executar(() => service.triage(r.id, r.version))}>
                        <Clock className="size-4" /> Iniciar triagem
                      </Button>
                    ) : null}
                    {pode("MARK_IN_PROGRESS") ? (
                      <Button size="sm" variant="outline" disabled={comando.isPending} onClick={() => executar(() => service.status(r.id, r.version, "IN_PROGRESS"))}>
                        <Play className="size-4" /> Em atendimento
                      </Button>
                    ) : null}
                    {pode("RESOLVE") ? (
                      <Button size="sm" variant="outline" disabled={comando.isPending} onClick={() => executar(() => service.status(r.id, r.version, "RESOLVED", mensagem.trim() || undefined), () => setMensagem(""))}>
                        <CheckCircle2 className="size-4" /> Resolver
                      </Button>
                    ) : null}
                    {pode("REJECT") ? (
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={comando.isPending} onClick={() => executar(() => service.status(r.id, r.version, "REJECTED", mensagem.trim() || undefined), () => setMensagem(""))}>
                        <XCircle className="size-4" /> Recusar
                      </Button>
                    ) : null}
                    {pode("CREATE_OPERATION") ? (
                      <Button size="sm" disabled={comando.isPending} onClick={() => setConvertendo(true)}>
                        <ArrowRightLeft className="size-4" /> Criar atendimento
                      </Button>
                    ) : null}
                  </div>
                  {pode("ASSIGN") ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <UserCheck className="size-4 text-muted-foreground" />
                      <Select
                        value={r.assignedTo?.id ?? ""}
                        onValueChange={(userId) => executar(() => service.assign(r.id, r.version, userId))}
                      >
                        <SelectTrigger className="h-9 w-64">
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
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">
                    Resolver ou recusar com a mensagem abaixo envia a mensagem ao cliente junto.
                  </p>
                </section>
              ) : null}

              <section className="space-y-3">
                <SectionTitle>Conversa</SectionTitle>
                <Conversation request={r} internal />
              </section>

              {pode("ADD_PUBLIC_RESPONSE") || pode("ADD_INTERNAL_NOTE") ? (
                <form
                  className="space-y-2"
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
                      className={cn("flex-1 rounded-md px-3 py-1.5", !interna && "bg-background font-medium shadow-sm")}
                    >
                      Responder ao cliente
                    </button>
                    <button
                      type="button"
                      onClick={() => setInterna(true)}
                      className={cn("flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-1.5", interna && "bg-background font-medium shadow-sm")}
                    >
                      <Lock className="size-3.5" /> Nota interna
                    </button>
                  </div>
                  <Textarea
                    rows={3}
                    maxLength={4000}
                    value={mensagem}
                    onChange={(e) => setMensagem(e.target.value)}
                    placeholder={interna ? "Só a equipe vê esta nota." : "O cliente vê esta mensagem no portal e no app."}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={comando.isPending || !mensagem.trim()}>
                      {comando.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
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
                </form>
              ) : null}
              <MutationError error={comando.error} />
            </>
          )}
        </div>
      </SheetContent>
      {r && convertendo ? (
        <ConvertDialog request={r} onClose={() => setConvertendo(false)} />
      ) : null}
    </Sheet>
  );
}

/** Cria o atendimento a partir do chamado — tudo pré-preenchido. */
function ConvertDialog({ request, onClose }: { request: ServiceRequest; onClose: () => void }) {
  const unidades = useBusinessUnits();
  const comando = useServiceRequestCommand();
  const chave = useMemo(() => `web-convert-${crypto.randomUUID()}`, []);
  const [unidade, setUnidade] = useState(request.businessUnit?.id ?? "");
  const [codigo, setCodigo] = useState(() => {
    const data = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const [sorteado] = crypto.getRandomValues(new Uint32Array(1));
    return `OS-${data}-${String((sorteado ?? 0) % 1_000_000).padStart(6, "0")}`;
  });
  const [tipo, setTipo] = useState(
    request.category.code === "EQUIPMENT_PROBLEM" || request.category.code === "MAINTENANCE"
      ? "MAINTENANCE"
      : "OTHER",
  );
  const [titulo, setTitulo] = useState(request.subject);
  const descricao = [
    request.description,
    request.details.equipmentCondition ? `Equipamento: ${request.details.equipmentCondition.label}` : null,
    request.details.siteLocation ? `Local: ${request.details.siteLocation}` : null,
    request.details.availability ? `Melhor horário: ${request.details.availability}` : null,
    request.details.contactName
      ? `Contato: ${request.details.contactName}${request.details.contactPhone ? ` — ${request.details.contactPhone}` : ""}`
      : null,
    `Chamado ${request.code}`,
  ]
    .filter(Boolean)
    .join("\n");

  const lista = unidades.data ?? [];

  return (
    <Dialog open onOpenChange={(v) => !v && !comando.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Criar atendimento</DialogTitle>
          <DialogDescription>
            O chamado vira um atendimento com o cliente, o equipamento e os detalhes já preenchidos.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Unidade</Label>
            <Select value={unidade} onValueChange={setUnidade}>
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
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={comando.isPending}>
            Cancelar
          </Button>
          <Button
            disabled={comando.isPending || !unidade || codigo.trim().length < 2 || titulo.trim().length < 2}
            onClick={() =>
              comando.mutate(
                () =>
                  service.convert(request.id, chave, {
                    expectedVersion: request.version,
                    businessUnitId: unidade,
                    code: codigo.trim(),
                    kind: tipo,
                    title: titulo.trim(),
                    description: descricao.slice(0, 5000),
                  }),
                { onSuccess: onClose },
              )
            }
          >
            {comando.isPending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
            Criar atendimento
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
