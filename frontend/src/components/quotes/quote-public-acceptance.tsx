"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Download,
  FileText,
  Loader2,
  ShieldCheck,
  XCircle,
  MessageSquare,
  Clock,
  MapPin,
  Wrench,
} from "lucide-react";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/signature/signature-pad";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import {
  quoteAcceptanceService,
  type QuoteCustomerDecision,
} from "@/services/quote-acceptance.service";
import type { QuoteAcceptanceReadModel } from "@/types/contracts/modules/quotes/quote-acceptance.read-models";

export function QuotePublicAcceptance({ token }: { token: string }) {
  const key = ["public-quote-acceptance", token];
  const query = useQuery({
    queryKey: key,
    queryFn: () => quoteAcceptanceService.read(token),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  });
  const cache = useQueryClient();
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-5 py-5">
          <OrbitLogo />
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-4" />
            Proposta e aceite
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-2xl space-y-5 px-4 py-6 sm:px-6 sm:py-10">
        {query.isPending ? (
          <p className="flex items-center justify-center gap-2 py-20">
            <Loader2 className="size-5 animate-spin" />
            Carregando proposta…
          </p>
        ) : query.error || !query.data ? (
          <div className="space-y-3 rounded-2xl border border-border p-6">
            <h1 className="text-xl font-semibold">
              Não encontramos esta proposta
            </h1>
            <p className="text-sm text-muted-foreground">
              Confira se recebeu o link completo ou peça um novo a quem enviou o
              orçamento.
            </p>
          </div>
        ) : (
          <ProposalContent
            key={token}
            token={token}
            data={query.data}
            onAnswered={(data) => cache.setQueryData(key, data)}
          />
        )}
        <p className="text-center text-xs text-muted-foreground">
          Conferência e aceite da proposta comercial · Orbit
        </p>
      </main>
    </div>
  );
}

function ProposalContent({
  token,
  data,
  onAnswered,
}: {
  token: string;
  data: QuoteAcceptanceReadModel;
  onAnswered: (data: QuoteAcceptanceReadModel) => void;
}) {
  const download = useMutation({
    mutationFn: () => quoteAcceptanceService.document(token),
  });
  const proposal = data.proposal;
  const money = (value: string) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: proposal?.currency ?? "BRL",
    }).format(Number(value));
  if (!proposal)
    return (
      <section className="space-y-3 rounded-2xl border border-border p-6">
        <Clock className="size-9 text-primary" />
        <h1 className="text-xl font-semibold">
          {data.state === "EXPIRED"
            ? "O prazo deste link terminou"
            : data.state === "UPDATED"
              ? "A proposta foi atualizada"
              : "Este link foi substituído"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Peça um novo link à empresa para conferir a proposta atual antes de
          responder.
        </p>
      </section>
    );
  return (
    <>
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-7">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-primary">
          <FileText className="size-4" />
          Orçamento {proposal.code}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {proposal.title}
        </h1>
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted-foreground">Proposta de </span>
            {proposal.emitterName}
          </p>
          <p>
            <span className="text-muted-foreground">Para </span>
            {proposal.customerName}
          </p>
          {proposal.validUntil ? (
            <p className="text-muted-foreground">
              Válido até {proposal.validUntil.split("-").reverse().join("/")}
            </p>
          ) : null}
        </div>
        <div className="rounded-xl bg-primary/5 p-4">
          <p className="text-xs text-muted-foreground">
            Valor total da proposta
          </p>
          <p className="mt-1 text-3xl font-semibold text-primary">
            {money(proposal.total)}
          </p>
        </div>
        <Button
          className="w-full sm:w-auto"
          variant="outline"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          <Download className="size-4" />
          {download.isPending ? "Baixando…" : "Baixar orçamento em PDF"}
        </Button>
        <MutationError error={download.error} />
      </section>
      {data.response ? (
        <section
          role="status"
          className="space-y-2 rounded-2xl border border-primary/25 bg-primary/5 p-5"
        >
          <CheckCircle2 className="size-8 text-primary" />
          <h2 className="text-lg font-semibold">
            {data.response.decision === "APPROVE"
              ? "Orçamento aprovado e assinatura registrada"
              : data.response.decision === "REJECT"
                ? "Recusa registrada"
                : "Pedido de alterações enviado"}
          </h2>
          <p className="text-sm">
            Resposta de {data.response.signerName}.{" "}
            {data.response.decision === "REQUEST_CHANGES"
              ? "A empresa vai revisar a proposta e enviar um novo link para sua conferência."
              : "A empresa já pode consultar sua resposta."}
          </p>
          {data.response.reason ? (
            <p className="whitespace-pre-wrap rounded-lg bg-background/60 p-3 text-sm">
              {data.response.reason}
            </p>
          ) : null}
        </section>
      ) : null}
      {proposal.introText ? (
        <p className="whitespace-pre-wrap px-1 text-sm leading-relaxed">
          {proposal.introText}
        </p>
      ) : null}
      <section className="space-y-4 rounded-2xl border border-border bg-card p-5 sm:p-7">
        <h2 className="text-lg font-semibold">O que está incluído</h2>
        <div className="divide-y divide-border">
          {proposal.items.map((item, index) => (
            <article key={index} className="space-y-2 py-4 first:pt-0">
              <div className="flex items-start justify-between gap-4">
                <h3 className="min-w-0 break-words text-sm font-medium">
                  {item.description}
                </h3>
                <span className="shrink-0 text-sm font-semibold">
                  {money(item.total)}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {Number(item.quantity).toLocaleString("pt-BR")} {item.unit} ·{" "}
                {money(item.unitPrice)} por unidade
                {Number(item.discount) > 0
                  ? ` · Desconto ${money(item.discount)}`
                  : ""}
              </p>
              {item.notes ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {item.notes}
                </p>
              ) : null}
            </article>
          ))}
        </div>
        <dl className="space-y-2 border-t border-border pt-4 text-sm">
          <div className="flex justify-between">
            <dt>Subtotal</dt>
            <dd>{money(proposal.subtotal)}</dd>
          </div>
          {Number(proposal.discount) > 0 ? (
            <div className="flex justify-between">
              <dt>Desconto</dt>
              <dd>− {money(proposal.discount)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between font-semibold">
            <dt>Total</dt>
            <dd>{money(proposal.total)}</dd>
          </div>
        </dl>
      </section>
      {proposal.serviceAddress || proposal.equipment.length ? (
        <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
          {proposal.serviceAddress ? (
            <p className="flex items-start gap-2 text-sm">
              <MapPin className="mt-0.5 size-4 shrink-0 text-primary" />
              {proposal.serviceAddress}
            </p>
          ) : null}
          {proposal.equipment.map((item, index) => (
            <p key={index} className="flex items-start gap-2 text-sm">
              <Wrench className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                {item.name}
                {item.identifier ? ` · ${item.identifier}` : ""}
                {item.location ? ` — ${item.location}` : ""}
              </span>
            </p>
          ))}
        </section>
      ) : null}
      {proposal.notes ? (
        <section className="space-y-2 rounded-2xl border border-border p-5">
          <h2 className="font-semibold">Condições e observações</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {proposal.notes}
          </p>
        </section>
      ) : null}
      {!data.response ? (
        <ReplyForm token={token} onAnswered={onAnswered} />
      ) : null}
    </>
  );
}

function ReplyForm({
  token,
  onAnswered,
}: {
  token: string;
  onAnswered: (data: QuoteAcceptanceReadModel) => void;
}) {
  const signature = useRef<SignaturePadHandle | null>(null);
  const [decision, setDecision] = useState<QuoteCustomerDecision>("APPROVE");
  const [name, setName] = useState(""),
    [document, setDocument] = useState(""),
    [email, setEmail] = useState(""),
    [reason, setReason] = useState("");
  const [consent, setConsent] = useState(false),
    [hasInk, setHasInk] = useState(false),
    [error, setError] = useState<string | null>(null);
  const reply = useMutation({
    mutationFn: async () => {
      let signatureBase64: string | undefined;
      if (decision === "APPROVE") {
        const blob = await signature.current?.exportar();
        if (!blob)
          throw new Error("Desenhe sua assinatura antes de confirmar.");
        signatureBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      return quoteAcceptanceService.respond(token, {
        decision,
        signerName: name.trim(),
        signerDocument: document.trim() || undefined,
        signerEmail: email.trim() || undefined,
        reason: decision === "APPROVE" ? undefined : reason.trim(),
        signatureBase64,
        consentAccepted: consent,
      });
    },
    onSuccess: onAnswered,
  });
  const ready =
    name.trim().length >= 3 &&
    (decision === "APPROVE" ? consent && hasInk : reason.trim().length >= 5);
  return (
    <section className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-7">
      <div>
        <h2 className="text-xl font-semibold">Como deseja responder?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Confira os itens e as condições antes de confirmar sua decisão.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {(
          [
            {
              value: "APPROVE",
              label: "Aprovar e assinar",
              icon: CheckCircle2,
            },
            {
              value: "REQUEST_CHANGES",
              label: "Pedir alterações",
              icon: MessageSquare,
            },
            { value: "REJECT", label: "Recusar proposta", icon: XCircle },
          ] as const
        ).map((option) => (
          <Button
            key={option.value}
            type="button"
            className="h-auto justify-start whitespace-normal py-3 sm:flex-col"
            variant={decision === option.value ? "default" : "outline"}
            disabled={reply.isPending}
            aria-pressed={decision === option.value}
            onClick={() => {
              setDecision(option.value);
              setHasInk(false);
              signature.current?.limpar();
              setError(null);
            }}
          >
            <option.icon className="size-4 shrink-0" />
            {option.label}
          </Button>
        ))}
      </div>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          if (!ready) {
            setError(
              "Informe seu nome e complete os campos necessários para esta resposta.",
            );
            return;
          }
          reply.mutate();
        }}
      >
        <div className="space-y-2">
          <Label htmlFor="customer-name">Seu nome completo *</Label>
          <Input
            id="customer-name"
            autoComplete="name"
            required
            minLength={3}
            maxLength={180}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={reply.isPending}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="customer-document">CPF/CNPJ (opcional)</Label>
            <Input
              id="customer-document"
              inputMode="numeric"
              maxLength={40}
              value={document}
              onChange={(event) => setDocument(event.target.value)}
              disabled={reply.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="customer-email">E-mail (opcional)</Label>
            <Input
              id="customer-email"
              type="email"
              autoComplete="email"
              maxLength={180}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={reply.isPending}
            />
          </div>
        </div>
        {decision === "APPROVE" ? (
          <>
            <SignaturePad
              handleRef={signature}
              onChange={setHasInk}
              disabled={reply.isPending}
            />
            <label className="flex items-start gap-3 rounded-xl bg-muted/40 p-4 text-sm leading-relaxed">
              <input
                className="mt-1 size-4 shrink-0 accent-primary"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                disabled={reply.isPending}
                required
              />
              <span>
                Li os itens, valores e condições desta proposta e autorizo sua
                execução. Confirmo que esta assinatura representa meu aceite.
              </span>
            </label>
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="customer-reason">
              {decision === "REJECT"
                ? "Motivo da recusa *"
                : "O que precisa ser alterado? *"}
            </Label>
            <Textarea
              id="customer-reason"
              required
              minLength={5}
              maxLength={2000}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={reply.isPending}
            />
          </div>
        )}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <MutationError error={reply.error} />
        <Button
          className="w-full py-6"
          type="submit"
          disabled={!ready || reply.isPending}
        >
          {reply.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {reply.isPending
            ? "Registrando sua resposta…"
            : decision === "APPROVE"
              ? "Assinar e aprovar orçamento"
              : decision === "REJECT"
                ? "Confirmar recusa"
                : "Enviar pedido de alterações"}
        </Button>
      </form>
    </section>
  );
}
