"use client";

/**
 * O wizard de recibo.
 *
 * ## Três passos, e um rascunho na memória
 *
 * O recibo só existe no servidor quando a pessoa confirma. Criá-lo no passo 2 e ir
 * preenchendo deixaria um rascunho órfão por cada wizard abandonado — e um recibo
 * órfão é pior que um orçamento órfão: ele consome um número da sequência, e a
 * numeração de recibo é citada em cobrança.
 *
 * ## O que decide o avanço mora no modelo
 *
 * `stepIssues` responde o que falta, em frases. Este componente desenha o passo,
 * mostra o que falta e libera o botão. As regras têm teste; o desenho, não precisa.
 *
 * ## Emitir é dois atos, e a tela diz isso
 *
 * Confirmar cria o recibo em **rascunho** com os campos preenchidos; em seguida o
 * documento é pedido ao motor premium. A receita confirmada no Financeiro nasce
 * quando o manifesto é publicado — não quando o rascunho existe. Juntar as duas
 * coisas num botão faria um rascunho conferido pela metade virar dinheiro lançado.
 */
import { useCallback, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";

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
import { useCreateReceipt } from "@/hooks/financial/use-financial";
import { useOperationsList } from "@/hooks/operations/use-operations";
import { documentsService } from "@/services/documents.service";
import { financialService } from "@/services/financial.service";
import { ROUTES } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { FORMATTERS } from "@/metrics";
import { formatDate } from "@/lib/formatters";
import {
  RECEIPT_STEPS,
  STEP_TITLES,
  canIssue,
  createPayload,
  emptyDraft,
  fromOperation,
  parseAmount,
  stepIssues,
  type ReceiptDraft,
} from "./receipt-wizard.model";

export function ReceiptWizardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  /* Remonta a cada abertura: um rascunho da sessão anterior reaparecendo com o
     valor de outro recibo é o tipo de erro que só se descobre no papel assinado. */
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <Body onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<ReceiptDraft>(() => emptyDraft());

  const create = useCreateReceipt();
  const step = RECEIPT_STEPS[index]!;
  const issues = stepIssues(step, draft);

  const patch = useCallback(
    (changes: Partial<ReceiptDraft>) =>
      setDraft((current) => ({ ...current, ...changes })),
    [],
  );

  /**
   * Confirmar: cria o recibo e **pede o documento**.
   *
   * O pedido de renderização vai depois da criação, e uma falha nele não desfaz o
   * recibo: o rascunho existe, com os campos certos, e a emissão pode ser repetida
   * da própria tela do documento. Desfazer a criação por causa de uma fila de
   * renderização ocupada perderia o número já reservado.
   */
  const issue = () =>
    create.mutate(createPayload(draft), {
      onSuccess: async (execution) => {
        try {
          await documentsService.requestRender(execution.id, {});
        } catch {
          /* O documento é pedido de novo na tela da execução, que mostra o estado
             real da renderização. Falhar aqui não pode esconder o recibo criado. */
        }
        onOpenChange(false);
        router.push(`${ROUTES.executions}/${execution.id}`);
      },
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Novo recibo</DialogTitle>
        <DialogDescription>
          {index + 1} de {RECEIPT_STEPS.length} · {STEP_TITLES[step]}
        </DialogDescription>
      </DialogHeader>

      <Progress current={index} draft={draft} onJump={setIndex} />

      <div className="py-4">
        {step === "origem" ? (
          <OriginStep draft={draft} onChange={patch} />
        ) : step === "dados" ? (
          <DataStep draft={draft} onChange={patch} />
        ) : (
          <ReviewStep draft={draft} onChange={patch} />
        )}
      </div>

      {issues.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-border px-3 py-2">
          {issues.map((issue) => (
            <li key={issue} className="text-muted-foreground text-xs">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}

      {create.error ? <MutationError error={create.error} /> : null}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          disabled={index === 0 || create.isPending}
          onClick={() => setIndex((value) => value - 1)}
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={create.isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>

          {step === "resumo" ? (
            <Button
              type="button"
              disabled={!canIssue(draft) || create.isPending}
              onClick={issue}
            >
              {create.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Emitir recibo
            </Button>
          ) : (
            <Button
              type="button"
              disabled={issues.length > 0 || create.isPending}
              onClick={() => setIndex((value) => value + 1)}
            >
              Continuar
              <ArrowRight className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

/** O trilho: onde estou, o que já resolvi, quantos faltam. */
function Progress({
  current,
  draft,
  onJump,
}: {
  current: number;
  draft: ReceiptDraft;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {RECEIPT_STEPS.map((step, index) => {
        const resolvido = stepIssues(step, draft).length === 0;
        return (
          <li key={step}>
            <button
              type="button"
              /* Só para trás: pular adiante levaria a um passo cujas condições o
                 anterior ainda não cumpriu. */
              disabled={index > current}
              onClick={() => onJump(index)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                index === current
                  ? "bg-secondary text-secondary-foreground"
                  : resolvido
                    ? "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/60",
                index > current && "cursor-not-allowed",
              )}
            >
              {index + 1}. {STEP_TITLES[step]}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Passo 1 — origem                                                    */
/* ------------------------------------------------------------------ */

/**
 * Do zero ou de um serviço executado.
 *
 * A lista oferece **atendimentos concluídos**, e só eles: recibo prova pagamento de
 * serviço feito, e oferecer um em andamento convidaria a receber antes de entregar.
 * O servidor recusa de qualquer forma — aqui a tela evita o convite.
 */
function OriginStep({
  draft,
  onChange,
}: {
  draft: ReceiptDraft;
  onChange: (changes: Partial<ReceiptDraft>) => void;
}) {
  const completed = useOperationsList({
    status: "COMPLETED",
    page: 1,
    limit: 20,
  });

  /**
   * O atendimento é consultado **no clique**, não por efeito.
   *
   * A primeira versão lia o resultado de uma consulta e aplicava no rascunho
   * durante a renderização — `setState` no meio do render, que é o caminho curto
   * para um laço e para estado inconsistente. Aqui a escolha é um ato: a pessoa
   * clica, o servidor responde o que aquele atendimento oferece, e o rascunho
   * recebe de uma vez.
   *
   * É também onde a recusa aparece: o servidor rejeita atendimento não concluído —
   * recibo prova pagamento de serviço feito — e a frase dele é o que a tela mostra.
   */
  const [buscando, setBuscando] = useState<string | null>(null);
  const [erro, setErro] = useState<unknown>(null);

  const escolher = async (operationId: string) => {
    setBuscando(operationId);
    setErro(null);
    try {
      const source = await financialService.receiptSource(operationId);
      onChange(fromOperation(draft, source));
    } catch (problema) {
      setErro(problema);
      /* O atendimento não serve: o rascunho não fica apontando para ele. */
      onChange({ origin: "OPERATION", operationId: null });
    } finally {
      setBuscando(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <OriginCard
          title="Do zero"
          description="Adiantamento, acerto, peça vendida no balcão — o recibo que não vem de um atendimento."
          selected={draft.origin === "SCRATCH"}
          onSelect={() =>
            onChange({ origin: "SCRATCH", operationId: null, customerId: null })
          }
        />
        <OriginCard
          title="De um serviço executado"
          description="O pagador e a referência vêm do atendimento concluído. O valor você informa."
          selected={draft.origin === "OPERATION"}
          onSelect={() => onChange({ origin: "OPERATION" })}
        />
      </div>

      {draft.origin === "OPERATION" ? (
        <div className="space-y-2">
          <Label>Atendimento concluído</Label>
          {completed.isPending ? (
            <p className="text-muted-foreground text-sm">Carregando…</p>
          ) : (completed.data?.data ?? []).length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nenhum atendimento concluído para faturar. Um recibo do zero cobre o
              caso de adiantamento ou acerto.
            </p>
          ) : (
            <ul className="divide-border max-h-64 divide-y overflow-y-auto rounded-lg border border-border">
              {(completed.data?.data ?? []).map((operation) => (
                <li key={operation.id}>
                  <button
                    type="button"
                    disabled={buscando !== null}
                    onClick={() => void escolher(operation.id)}
                    className={cn(
                      "w-full px-3 py-2 text-left text-sm transition-colors hover:bg-secondary/40",
                      draft.operationId === operation.id && "bg-secondary/60",
                    )}
                  >
                    <span className="block truncate font-medium">
                      {operation.title}
                      {buscando === operation.id ? " · carregando…" : ""}
                    </span>
                    <span className="text-muted-foreground block truncate font-mono text-xs">
                      {operation.serviceOrderCode ?? operation.code}
                      {operation.customer
                        ? ` · ${operation.customer.tradeName ?? operation.customer.legalName}`
                        : ""}
                      {operation.completedAt
                        ? ` · ${formatDate(operation.completedAt)}`
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {erro ? <MutationError error={erro} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function OriginCard({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "rounded-lg border px-3 py-3 text-left transition-colors",
        selected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-secondary/40",
      )}
    >
      <span className="block text-sm font-medium">{title}</span>
      <span className="text-muted-foreground mt-1 block text-xs">
        {description}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Passo 2 — os dados                                                  */
/* ------------------------------------------------------------------ */

function DataStep({
  draft,
  onChange,
}: {
  draft: ReceiptDraft;
  onChange: (changes: Partial<ReceiptDraft>) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Recebemos de" htmlFor="receipt-payer" className="sm:col-span-2">
        <Input
          id="receipt-payer"
          value={draft.payer}
          onChange={(event) => onChange({ payer: event.target.value })}
          maxLength={180}
        />
      </Field>

      <Field
        label="CNPJ ou CPF"
        htmlFor="receipt-document"
        hint="Opcional. Quando informado, sai no corpo da quitação."
      >
        <Input
          id="receipt-document"
          value={draft.payerDocument}
          onChange={(event) => onChange({ payerDocument: event.target.value })}
          maxLength={40}
          className="font-mono"
        />
      </Field>

      <Field
        label="Valor recebido"
        htmlFor="receipt-amount"
        hint="Em reais: 1.234,56. O documento imprime o número e o valor por extenso."
      >
        <Input
          id="receipt-amount"
          value={draft.amount}
          onChange={(event) => onChange({ amount: event.target.value })}
          inputMode="decimal"
          className="font-mono"
        />
      </Field>

      <Field label="Data do recebimento" htmlFor="receipt-date">
        <Input
          id="receipt-date"
          type="date"
          value={draft.paidOn}
          onChange={(event) => onChange({ paidOn: event.target.value })}
        />
      </Field>

      <Field
        label="Forma de pagamento"
        htmlFor="receipt-method"
        hint="Dinheiro, Pix, cartão, transferência…"
      >
        <Input
          id="receipt-method"
          value={draft.paymentMethod}
          onChange={(event) => onChange({ paymentMethod: event.target.value })}
          maxLength={60}
        />
      </Field>

      <Field
        label="Referente a"
        htmlFor="receipt-referring"
        className="sm:col-span-2"
        hint="O que foi pago. É o que o cliente lê para reconhecer o serviço."
      >
        <Textarea
          id="receipt-referring"
          value={draft.referring}
          onChange={(event) => onChange({ referring: event.target.value })}
          rows={3}
          maxLength={2000}
        />
      </Field>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Passo 3 — resumo                                                    */
/* ------------------------------------------------------------------ */

/**
 * O que vai sair no papel.
 *
 * Recibo é o único documento da série que prova um fato jurídico: depois de
 * assinado, quem pagou tem como provar que pagou. A conferência antes de emitir não
 * é formalidade — é o último momento em que um erro é só um erro.
 */
function ReviewStep({
  draft,
  onChange,
}: {
  draft: ReceiptDraft;
  onChange: (changes: Partial<ReceiptDraft>) => void;
}) {
  const valor = parseAmount(draft.amount);

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 rounded-lg border border-border px-3 py-3 sm:grid-cols-2">
        <Row label="Recebemos de" value={draft.payer} />
        <Row label="CNPJ ou CPF" value={draft.payerDocument || "—"} />
        <Row
          label="Valor"
          value={valor ? FORMATTERS.currency(Number(valor)) : "—"}
          emphasis
        />
        <Row label="Data" value={draft.paidOn ? formatDate(draft.paidOn) : "—"} />
        <Row label="Forma de pagamento" value={draft.paymentMethod || "—"} />
        <Row
          label="Origem"
          value={
            draft.origin === "OPERATION"
              ? "Serviço executado"
              : "Recibo do zero"
          }
        />
        <div className="sm:col-span-2">
          <dt className="text-muted-foreground text-xs">Referente a</dt>
          <dd className="text-sm whitespace-pre-wrap">{draft.referring}</dd>
        </div>
      </dl>

      <p className="text-muted-foreground text-xs">
        O número do recibo é gerado na emissão, com a contagem da sua organização. O
        documento sai no modelo premium de recibo e entra no Financeiro como receita
        quando a emissão for publicada.
      </p>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.confirmed}
          onChange={(event) => onChange({ confirmed: event.target.checked })}
          className="mt-0.5"
        />
        <span>
          Confiro que os dados acima estão corretos. Depois de assinado, o recibo
          prova a quitação.
        </span>
      </label>
    </div>
  );
}

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd
        className={cn(
          "text-sm",
          emphasis && "font-display text-lg font-bold tabular-nums",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}
