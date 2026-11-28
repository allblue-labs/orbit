"use client";

/**
 * Os chamados do cliente na web: abrir (assistente), acompanhar, responder,
 * corrigir e cancelar. As mesmas regras do app — e as do servidor, que é quem
 * decide: as ações que aparecem são as `allowedActions` do chamado.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  BadgeHelp,
  Check,
  CheckCircle2,
  Circle,
  FileText,
  Hammer,
  LifeBuoy,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  Send,
  Snowflake,
  TriangleAlert,
  Wrench,
  X,
  XCircle,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
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
import { Textarea } from "@/components/ui/textarea";
import { errorCopy } from "@/lib/error-copy";
import { cn } from "@/lib/utils";
import {
  newIdempotencyKey,
  useCancelRequest,
  useOpenRequest,
  usePortalAssets,
  usePortalRequest,
  usePortalRequests,
  usePortalSession,
  useReplyRequest,
  useUpdateRequest,
} from "@/portal/portal-hooks";
import type { ServiceRequest } from "@/portal/portal-types";
import {
  DESCRIPTION_HINTS,
  draftFrom,
  emptyDraft,
  EQUIPMENT_CONDITIONS,
  isActiveRequest,
  REQUEST_CATEGORIES,
  REQUEST_URGENCIES,
  requestTone,
  stepProblem,
  suggestedSubject,
  timelineMilestone,
  urgencyBadge,
  WIZARD_STEPS,
  type RequestCategory,
  type RequestDraft,
} from "@/portal/service-request-model";
import { PageTitle } from "./portal-pages";
import {
  Facts,
  formatDate,
  formatDateTime,
  IconTile,
  PortalDrawer,
  ItemCard,
  ListSkeleton,
  Note,
  Pill,
  SectionTitle,
  type PortalTone,
} from "./portal-ui";

const ICONES: Record<RequestCategory, typeof Wrench> = {
  EQUIPMENT_PROBLEM: TriangleAlert,
  MAINTENANCE: Wrench,
  SERVICE_REQUEST: Hammer,
  DOCUMENT_REQUEST: FileText,
  QUESTION: BadgeHelp,
  OTHER: MessageSquare,
};

const urgencyTone = (code: string): PortalTone =>
  code === "URGENT" ? "danger" : code === "HIGH" ? "warning" : "neutral";

export function PortalRequests() {
  const router = useRouter();
  const params = useSearchParams();
  const chamados = usePortalRequests();
  const [aberto, setAberto] = useState<string | null>(null);
  /* `?novo=1` (vindo do Início ou de um equipamento) abre o assistente. */
  const [assistente, setAssistente] = useState<{
    editing?: ServiceRequest;
    assetId?: string | null;
  } | null>(() =>
    params.get("novo") === "1"
      ? { assetId: params.get("equipamento") }
      : null,
  );
  /* E a URL volta a ser a da lista: recarregar não reabre o assistente. */
  useEffect(() => {
    if (params.get("novo") === "1") router.replace("/portal/chamados");
  }, [params, router]);

  const lista = chamados.data?.data ?? [];
  const ativos = lista.filter((r) => isActiveRequest(r.status.code));
  const encerrados = lista.filter((r) => !isActiveRequest(r.status.code));

  return (
    <div className="space-y-6">
      <PageTitle
        title="Chamados"
        description="Peça manutenção, avise sobre um problema ou tire uma dúvida. A equipe responde por aqui."
        action={
          <Button onClick={() => setAssistente({})}>
            <Plus className="size-4" />
            Abrir chamado
          </Button>
        }
      />
      {chamados.error ? (
        <Note icon={AlertCircle}>{errorCopy(chamados.error)}</Note>
      ) : !chamados.data ? (
        <ListSkeleton rows={3} />
      ) : lista.length === 0 ? (
        <Note icon={LifeBuoy}>
          Nenhum chamado ainda. Quando precisar de algo, abra um chamado e
          acompanhe tudo por aqui.
        </Note>
      ) : (
        <>
          {ativos.length > 0 ? (
            <section className="space-y-3">
              <SectionTitle>Em andamento</SectionTitle>
              <div className="grid gap-3 lg:grid-cols-2">
                {ativos.map((r) => (
                  <RequestCard key={r.id} request={r} onOpen={() => setAberto(r.id)} />
                ))}
              </div>
            </section>
          ) : null}
          {encerrados.length > 0 ? (
            <section className="space-y-3">
              <SectionTitle>Encerrados</SectionTitle>
              <div className="grid gap-3 lg:grid-cols-2">
                {encerrados.map((r) => (
                  <RequestCard key={r.id} request={r} onOpen={() => setAberto(r.id)} />
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}

      <RequestSheet
        key={aberto ?? "fechado"}
        id={aberto}
        onClose={() => setAberto(null)}
        onEdit={(request) => setAssistente({ editing: request })}
      />
      {assistente ? (
        <ServiceRequestWizard
          editing={assistente.editing}
          assetId={assistente.assetId ?? null}
          onClose={() => setAssistente(null)}
          onSaved={(request) => {
            setAssistente(null);
            setAberto(request.id);
          }}
        />
      ) : null}
    </div>
  );
}

function RequestCard({
  request,
  onOpen,
}: {
  request: ServiceRequest;
  onOpen: () => void;
}) {
  const esperando = request.status.code === "WAITING_CUSTOMER";
  return (
    <ItemCard
      onClick={onOpen}
      leading={
        <IconTile
          icon={ICONES[request.category.code] ?? MessageSquare}
          tone={requestTone(request.status.code)}
        />
      }
      title={request.subject}
      subtitle={`${request.code} · ${request.category.label}`}
      meta={`Atualizado em ${formatDate(request.updatedAt)}`}
      badges={
        <>
          <Pill tone={requestTone(request.status.code)}>
            {esperando ? "Aguardando sua resposta" : request.status.label}
          </Pill>
          {["URGENT", "HIGH"].includes(request.urgency.code) ? (
            <Pill tone={urgencyTone(request.urgency.code)}>
              {urgencyBadge(request.urgency.code, request.urgency.label)}
            </Pill>
          ) : null}
        </>
      }
    />
  );
}

function RequestSheet({
  id,
  onClose,
  onEdit,
}: {
  id: string | null;
  onClose: () => void;
  onEdit: (request: ServiceRequest) => void;
}) {
  const detalhe = usePortalRequest(id);
  const responder = useReplyRequest();
  const cancelar = useCancelRequest();
  const [mensagem, setMensagem] = useState("");
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  const r = detalhe.data;

  const podeEditar = r?.allowedActions.includes("EDIT") ?? false;
  const podeCancelar = r?.allowedActions.includes("CANCEL") ?? false;

  return (
    <PortalDrawer
      open={Boolean(id)}
      onClose={onClose}
      icon={(r && ICONES[r.category.code]) || MessageSquare}
      tone={r ? requestTone(r.status.code) : "info"}
      eyebrow={r ? `${r.category.label} · ${r.code}` : "Carregando…"}
      title={r?.subject ?? "Chamado"}
      badges={
        r ? (
          <>
            <Pill tone={requestTone(r.status.code)}>
              {r.status.code === "WAITING_CUSTOMER" ? "Aguardando sua resposta" : r.status.label}
            </Pill>
            <Pill tone={urgencyTone(r.urgency.code)}>
              {urgencyBadge(r.urgency.code, r.urgency.label)}
            </Pill>
          </>
        ) : null
      }
      meta={r ? `Aberto em ${formatDateTime(r.submittedAt)}` : null}
      footer={
        r && (podeEditar || podeCancelar) ? (
          confirmarCancelamento ? (
            <div className="space-y-2">
              <p className="text-sm">
                Cancelar este chamado? A equipe deixa de atendê-lo; o histórico
                continua aqui.
              </p>
              <MutationError error={cancelar.error} />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="ghost" onClick={() => setConfirmarCancelamento(false)}>
                  Voltar
                </Button>
                <Button
                  variant="destructive"
                  disabled={cancelar.isPending}
                  onClick={() =>
                    cancelar.mutate(
                      { id: r.id, version: r.version },
                      { onSuccess: () => setConfirmarCancelamento(false) },
                    )
                  }
                >
                  {cancelar.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Cancelar chamado
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className={cn("grid gap-2", podeEditar && podeCancelar && "grid-cols-2")}>
                {podeEditar ? (
                  <Button variant="outline" onClick={() => onEdit(r)}>
                    <Pencil className="size-4" />
                    Editar chamado
                  </Button>
                ) : null}
                {podeCancelar ? (
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmarCancelamento(true)}
                  >
                    <XCircle className="size-4" />
                    Cancelar chamado
                  </Button>
                ) : null}
              </div>
              {podeEditar ? (
                <p className="text-center text-xs text-muted-foreground">
                  Dá para editar até a equipe começar a analisar o chamado.
                </p>
              ) : null}
            </>
          )
        ) : null
      }
    >
      {!r ? (
        detalhe.error ? (
          <Note icon={AlertCircle}>{errorCopy(detalhe.error)}</Note>
        ) : (
          <ListSkeleton rows={3} />
        )
      ) : (
        <>
          {r.status.code === "WAITING_CUSTOMER" ? (
            <Note icon={MessageSquare}>
              A equipe está esperando sua resposta. Escreva abaixo para o
              chamado continuar.
            </Note>
          ) : null}
          <section className="space-y-2">
            <SectionTitle>O que você pediu</SectionTitle>
            <p className="whitespace-pre-line rounded-xl border border-border bg-card p-4 text-sm leading-relaxed shadow-sm">
              {r.description}
            </p>
          </section>
          <Facts
            items={[
              ["Equipamento", r.asset?.name],
              ["Situação do equipamento", r.details.equipmentCondition?.label],
              ["Onde fica", r.details.siteLocation],
              ["Melhor horário", r.details.availability],
              ["Contato", r.details.contactName],
              ["Telefone", r.details.contactPhone],
            ]}
          />
          <section className="space-y-3">
            <SectionTitle>Conversa</SectionTitle>
            <Conversation request={r} />
          </section>
          {r.allowedActions.includes("REPLY") ? (
            <form
              className="space-y-3 rounded-xl border border-border bg-card p-4 shadow-sm"
              onSubmit={(event) => {
                event.preventDefault();
                if (!mensagem.trim()) return;
                responder.mutate(
                  { id: r.id, version: r.version, message: mensagem.trim() },
                  { onSuccess: () => setMensagem("") },
                );
              }}
            >
              <Label htmlFor="portal-reply">Mensagem para a equipe</Label>
              <Textarea
                id="portal-reply"
                rows={3}
                maxLength={4000}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder="Escreva uma resposta ou acrescente uma informação."
              />
              <MutationError error={responder.error} />
              <Button type="submit" disabled={responder.isPending || !mensagem.trim()}>
                {responder.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                Enviar mensagem
              </Button>
            </form>
          ) : null}
        </>
      )}
    </PortalDrawer>
  );
}

/** Mensagens do cliente à direita, da equipe à esquerda, marcos no meio. */
export function Conversation({
  request,
  internal = false,
}: {
  request: ServiceRequest;
  /** Na visão da equipe, "Você" é a equipe e as notas internas aparecem. */
  internal?: boolean;
}) {
  if (request.timeline.length === 0)
    return <Note icon={MessageSquare}>Nenhuma mensagem ainda.</Note>;
  return (
    <ol className="space-y-2">
      {request.timeline.map((evento) => {
        const doCliente = evento.actor.type === "CUSTOMER_PORTAL";
        const nota = evento.visibility === "INTERNAL";
        if (!evento.message) {
          return (
            <li key={evento.id} className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span className="text-center">
                {timelineMilestone(evento.type, evento.statusChange?.to ?? null)} ·{" "}
                {formatDate(evento.createdAt)}
              </span>
              <span className="h-px flex-1 bg-border" />
            </li>
          );
        }
        const lado = internal ? !doCliente : doCliente;
        return (
          <li key={evento.id} className={cn("flex", lado ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] space-y-1 rounded-xl p-3 text-sm",
                nota
                  ? "border border-dashed border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30"
                  : lado
                    ? "bg-primary/10"
                    : "border border-border bg-card shadow-sm",
              )}
            >
              <p className="text-xs font-semibold">
                {!internal && doCliente ? "Você" : evento.actor.displayName}
                {nota ? " · nota interna" : ""}
              </p>
              <p className="whitespace-pre-line">{evento.message}</p>
              <p className="text-xs text-muted-foreground">{formatDateTime(evento.createdAt)}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Assistente                                                          */
/* ------------------------------------------------------------------ */

export function ServiceRequestWizard({
  editing,
  assetId,
  onClose,
  onSaved,
}: {
  editing?: ServiceRequest;
  assetId?: string | null;
  onClose: () => void;
  onSaved: (request: ServiceRequest) => void;
}) {
  const me = usePortalSession().data;
  const equipamentos = usePortalAssets("");
  const abrir = useOpenRequest();
  const salvar = useUpdateRequest();
  const [passo, setPasso] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [assuntoTocado, setAssuntoTocado] = useState(Boolean(editing));
  const [rascunho, setRascunho] = useState<RequestDraft>(() =>
    editing
      ? draftFrom(editing)
      : emptyDraft(me?.identity.displayName ?? "", assetId ?? null),
  );
  /* Uma chave por assistente: a nova tentativa é o mesmo pedido. */
  const chave = useMemo(() => newIdempotencyKey(), []);
  const lista = equipamentos.data?.data ?? [];
  const nomeDoEquipamento =
    lista.find((a) => a.id === rascunho.assetId)?.displayName ?? null;
  const enviando = abrir.isPending || salvar.isPending;
  const ultimo = passo === WIZARD_STEPS.length - 1;
  const mudar = (parcial: Partial<RequestDraft>) =>
    setRascunho((atual) => ({ ...atual, ...parcial }));

  const avancar = () => {
    const problema = stepProblem(passo, rascunho);
    if (problema) return setAviso(problema);
    setAviso(null);
    if (passo === 1 && !assuntoTocado)
      mudar({ subject: suggestedSubject(rascunho.category, nomeDoEquipamento) });
    setPasso((p) => p + 1);
  };

  const enviar = () =>
    editing
      ? salvar.mutate(
          { id: editing.id, version: editing.version, draft: rascunho },
          { onSuccess: onSaved },
        )
      : abrir.mutate({ draft: rascunho, key: chave }, { onSuccess: onSaved });

  return (
    <Dialog open onOpenChange={(v) => !v && !enviando && onClose()}>
      <DialogContent className="flex max-h-[92dvh] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="space-y-3 border-b border-border p-5 text-left">
          <DialogDescription className="text-xs font-semibold uppercase tracking-wider">
            {editing ? "Editar chamado" : "Abrir chamado"} · passo {passo + 1} de{" "}
            {WIZARD_STEPS.length}
          </DialogDescription>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${((passo + 1) / WIZARD_STEPS.length) * 100}%` }}
            />
          </div>
          <DialogTitle className="text-xl">{WIZARD_STEPS[passo]}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          {passo === 0 ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {REQUEST_CATEGORIES.map((c) => (
                <Choice
                  key={c.code}
                  icon={ICONES[c.code]}
                  title={c.label}
                  selected={rascunho.category === c.code}
                  onClick={() => {
                    mudar({ category: c.code });
                    setAviso(null);
                  }}
                />
              ))}
            </div>
          ) : passo === 1 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Escolher o equipamento ajuda o técnico a levar a peça certa.
                Opcional.
              </p>
              <Choice
                icon={X}
                title="Não é sobre um equipamento específico"
                selected={!rascunho.assetId}
                onClick={() => mudar({ assetId: null })}
              />
              {equipamentos.isPending ? <ListSkeleton rows={2} /> : null}
              {lista.map((a) => (
                <Choice
                  key={a.id}
                  icon={Snowflake}
                  title={a.displayName}
                  subtitle={[a.location, a.identifier].filter(Boolean).join(" · ")}
                  selected={rascunho.assetId === a.id}
                  onClick={() => mudar({ assetId: a.id })}
                />
              ))}
              {rascunho.assetId ? (
                <div className="space-y-2 pt-2">
                  <p className="text-sm font-medium">Como ele está agora?</p>
                  <div className="flex flex-wrap gap-2">
                    {EQUIPMENT_CONDITIONS.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() =>
                          mudar({
                            equipmentCondition:
                              rascunho.equipmentCondition === c.code ? null : c.code,
                          })
                        }
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-sm",
                          rascunho.equipmentCondition === c.code
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border",
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : passo === 2 ? (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="wz-subject">Assunto</Label>
                <Input
                  id="wz-subject"
                  maxLength={180}
                  value={rascunho.subject}
                  onChange={(e) => {
                    setAssuntoTocado(true);
                    mudar({ subject: e.target.value });
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wz-description">O que está acontecendo?</Label>
                <Textarea
                  id="wz-description"
                  rows={5}
                  maxLength={5000}
                  value={rascunho.description}
                  onChange={(e) => mudar({ description: e.target.value })}
                />
                {rascunho.category ? (
                  <p className="text-xs text-muted-foreground">
                    {DESCRIPTION_HINTS[rascunho.category]}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium">Qual a urgência?</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {REQUEST_URGENCIES.map((u) => (
                    <Choice
                      key={u.code}
                      icon={u.code === "URGENT" ? TriangleAlert : Circle}
                      tone={urgencyTone(u.code) === "neutral" ? "info" : urgencyTone(u.code)}
                      title={u.label}
                      subtitle={u.hint}
                      selected={rascunho.urgency === u.code}
                      onClick={() => mudar({ urgency: u.code })}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : passo === 3 ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Tudo opcional — mas poupa uma ligação antes da visita.
              </p>
              <Campo
                id="wz-site"
                label="Onde fica no local?"
                placeholder="Ex.: recepção, 2º andar, sala 204"
                value={rascunho.siteLocation}
                max={180}
                onChange={(v) => mudar({ siteLocation: v })}
              />
              <Campo
                id="wz-availability"
                label="Melhor dia e horário para a visita"
                placeholder="Ex.: dias úteis, das 8h às 12h"
                value={rascunho.availability}
                max={300}
                onChange={(v) => mudar({ availability: v })}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo
                  id="wz-contact"
                  label="Quem recebe o técnico"
                  value={rascunho.contactName}
                  max={120}
                  onChange={(v) => mudar({ contactName: v })}
                />
                <Campo
                  id="wz-phone"
                  label="Telefone de contato"
                  type="tel"
                  value={rascunho.contactPhone}
                  max={40}
                  onChange={(v) => mudar({ contactPhone: v })}
                />
              </div>
            </div>
          ) : (
            <Facts
              items={[
                ["Tipo", REQUEST_CATEGORIES.find((c) => c.code === rascunho.category)?.label],
                ["Assunto", rascunho.subject.trim()],
                ["O que está acontecendo", rascunho.description.trim()],
                ["Urgência", REQUEST_URGENCIES.find((u) => u.code === rascunho.urgency)?.label],
                ["Equipamento", nomeDoEquipamento],
                [
                  "Situação do equipamento",
                  rascunho.assetId
                    ? EQUIPMENT_CONDITIONS.find((c) => c.code === rascunho.equipmentCondition)?.label
                    : null,
                ],
                ["Onde fica", rascunho.siteLocation.trim()],
                ["Melhor horário", rascunho.availability.trim()],
                ["Contato", rascunho.contactName.trim()],
                ["Telefone", rascunho.contactPhone.trim()],
              ]}
            />
          )}
        </div>

        <div className="space-y-3 border-t border-border p-4">
          {aviso ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              {aviso}
            </p>
          ) : null}
          <MutationError error={abrir.error ?? salvar.error} />
          <div className="flex gap-2">
            {passo > 0 ? (
              <Button
                variant="outline"
                className="flex-1"
                disabled={enviando}
                onClick={() => {
                  setAviso(null);
                  setPasso((p) => p - 1);
                }}
              >
                Voltar
              </Button>
            ) : (
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                Cancelar
              </Button>
            )}
            <Button className="flex-[2]" disabled={enviando} onClick={ultimo ? enviar : avancar}>
              {enviando ? <Loader2 className="size-4 animate-spin" /> : ultimo ? <CheckCircle2 className="size-4" /> : null}
              {ultimo ? (editing ? "Salvar alterações" : "Abrir chamado") : "Continuar"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Choice({
  icon,
  title,
  subtitle,
  selected,
  onClick,
  tone = "info",
}: {
  icon: typeof Wrench;
  title: string;
  subtitle?: string;
  selected: boolean;
  onClick: () => void;
  tone?: PortalTone;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl border bg-card p-3 text-left transition-colors",
        selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
      )}
    >
      <IconTile icon={icon} tone={tone} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {subtitle ? (
          <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        ) : null}
      </span>
      {selected ? (
        <Check className="size-5 shrink-0 text-primary" />
      ) : (
        <Circle className="size-5 shrink-0 text-muted-foreground/40" />
      )}
    </button>
  );
}

function Campo({
  id,
  label,
  value,
  onChange,
  placeholder,
  max,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  max: number;
  type?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
