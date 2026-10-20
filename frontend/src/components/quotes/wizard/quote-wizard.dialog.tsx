"use client";

/**
 * O wizard de orçamento.
 *
 * ## Seis passos e um rascunho na memória
 *
 * A proposta só existe no servidor depois da aprovação. Criá-la no passo 2 e ir
 * editando deixaria um rascunho órfão por cada wizard abandonado — e abandonar um
 * formulário de seis passos é comum.
 *
 * ## O que decide o avanço mora no modelo
 *
 * `stepIssues` responde o que falta, em frases. Este componente não repete
 * nenhuma dessas regras: ele desenha o passo, mostra o que falta e libera o
 * botão. As regras têm teste; o desenho, não precisa.
 *
 * ## Copiar de atendimento é caminho curto
 *
 * Quando a origem é um atendimento, o servidor monta a proposta inteira numa
 * requisição — cliente, endereço, equipamentos, materiais. Refazer isso passo a
 * passo no navegador duplicaria a cópia que o backend já faz, e as duas
 * divergiriam. Então esse caminho pula direto para a proposta criada.
 */
import { useCallback, useMemo, useState } from "react";
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
import { useAssetsList } from "@/hooks/assets/use-assets";
import {
  useCustomer,
  useCustomerAddresses,
} from "@/hooks/customers/use-customers";
import { useOrganizationMembers } from "@/hooks/organization/use-organization";
import { useSession } from "@/providers/session-provider";
import { entityHref } from "@/entities";
import { cn } from "@/lib/utils";
import { AmountsStep } from "./steps/amounts.step";
import { GeneralStep } from "./steps/general.step";
import { ItemsStep } from "./steps/items.step";
import { OriginStep } from "./steps/origin.step";
import { ResponsibleStep } from "./steps/responsible.step";
import { ReviewStep } from "./steps/review.step";
import {
  STEP_TITLES,
  WIZARD_STEPS,
  canSubmit,
  emptyDraft,
  stepIssues,
  submissionPlan,
  type QuoteDraft,
} from "./quote-wizard.model";
import {
  QuoteWizardFailure,
  useQuoteWizardSubmit,
} from "./use-quote-wizard-submit";
import { useCreateQuoteFromOperation } from "./use-quote-from-operation";

export function QuoteWizardDialog({
  open,
  onOpenChange,
  /** Cliente já decidido — quando o wizard abre de dentro do cliente. */
  customerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string;
}) {
  /* Desmontar ao fechar zera o rascunho: reabrir depois de desistir deve
     começar do começo, não continuar um formulário que a pessoa abandonou. */
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
        <Body onOpenChange={onOpenChange} fixedCustomerId={customerId} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  onOpenChange,
  fixedCustomerId,
}: {
  onOpenChange: (open: boolean) => void;
  fixedCustomerId?: string;
}) {
  const session = useSession();
  const router = useRouter();

  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<QuoteDraft>(() => ({
    ...emptyDraft(session.user?.id ?? null),
    customerId: fixedCustomerId ?? null,
  }));

  /*
   * O nome do cliente fixado.
   *
   * Sem isso o seletor mostraria o texto de sugestão sobre um cliente que já está
   * escolhido, e a pessoa trocaria por outro pensando que nada foi preenchido.
   * Consulta só existe quando há cliente fixado.
   */
  const fixedCustomer = useCustomer(fixedCustomerId ?? "");
  const fixedLabel = fixedCustomerId
    ? (fixedCustomer.data?.tradeName ?? fixedCustomer.data?.legalName ?? null)
    : null;

  const submit = useQuoteWizardSubmit();
  const fromOperation = useCreateQuoteFromOperation();

  const step = WIZARD_STEPS[index]!;
  const issues = stepIssues(step, draft);
  const patch = useCallback(
    (changes: Partial<QuoteDraft>) =>
      setDraft((current) => ({ ...current, ...changes })),
    [],
  );

  /* O resumo mostra nomes, não ids. Quem tem as consultas resolve aqui e passa
     pronto — o passo de resumo não busca nada. */
  const members = useOrganizationMembers();
  const addresses = useCustomerAddresses(draft.customerId, true);
  const assets = useAssetsList(
    { customerId: draft.customerId ?? undefined, page: 1, limit: 50 },
    { enabled: Boolean(draft.customerId) },
  );

  const responsibleName =
    members.data?.data.find(
      (person) => person.userId === draft.responsibleUserId,
    )?.displayName ?? null;

  const addressSummary = useMemo(() => {
    const found = (addresses.data ?? []).find(
      (address) => address.id === draft.serviceAddressId,
    );
    if (!found) return null;
    return [
      found.label,
      [found.street, found.number].filter(Boolean).join(", "),
      found.city,
    ]
      .filter(Boolean)
      .join(" — ");
  }, [addresses.data, draft.serviceAddressId]);

  const assetNames = useMemo(
    () =>
      (assets.data?.data ?? [])
        .filter((asset) => draft.assetIds.includes(asset.id))
        .map((asset) => asset.identifier ?? asset.name),
    [assets.data, draft.assetIds],
  );

  const pending = submit.isPending || fromOperation.isPending;

  const finish = (quoteId: string) => {
    onOpenChange(false);
    const href = entityHref("quote", quoteId);
    if (href) router.push(href);
  };

  /**
   * Copiar de atendimento é uma requisição, não seis.
   *
   * O servidor já sabe copiar cliente, endereço, equipamentos e materiais.
   * Repetir isso aqui duplicaria a lógica de cópia, e as duas divergiriam.
   */
  const copyFromOperation = () =>
    fromOperation.mutate(
      { operationId: draft.operationId!, validUntil: draft.validUntil },
      { onSuccess: (quote) => finish(quote.id) },
    );

  const generate = () =>
    submit.mutate(submissionPlan(draft), {
      onSuccess: (quote) => finish(quote.id),
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Novo orçamento</DialogTitle>
        <DialogDescription>
          {index + 1} de {WIZARD_STEPS.length} · {STEP_TITLES[step]}
        </DialogDescription>
      </DialogHeader>

      <Progress current={index} onJump={setIndex} draft={draft} />

      <div className="py-4">
        {step === "origem" ? (
          <OriginStep draft={draft} onChange={patch} />
        ) : step === "dados" ? (
          <GeneralStep
            draft={{
              ...draft,
              customerLabel: draft.customerLabel ?? fixedLabel,
            }}
            onChange={patch}
          />
        ) : step === "itens" ? (
          <ItemsStep draft={draft} onChange={patch} />
        ) : step === "valores" ? (
          <AmountsStep draft={draft} onChange={patch} />
        ) : step === "responsavel" ? (
          <ResponsibleStep draft={draft} onChange={patch} />
        ) : (
          <ReviewStep
            draft={{
              ...draft,
              customerLabel: draft.customerLabel ?? fixedLabel,
            }}
            responsibleName={responsibleName}
            addressSummary={addressSummary}
            assetNames={assetNames}
            onChange={patch}
          />
        )}
      </div>

      {issues.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-border px-3 py-2">
          {issues.map((issue) => (
            <li key={issue} className="text-xs text-muted-foreground">
              {issue}
            </li>
          ))}
        </ul>
      ) : null}

      <SubmitError error={submit.error ?? fromOperation.error} />

      <div className="flex items-center justify-between gap-2 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          disabled={index === 0 || pending}
          onClick={() => setIndex((value) => value - 1)}
        >
          <ArrowLeft className="size-4" />
          Voltar
        </Button>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>

          {/* Copiar de atendimento não passa pelos outros passos: o servidor monta
              tudo, e a proposta abre pronta para revisão. */}
          {step === "origem" && draft.origin === "OPERATION" ? (
            <Button
              type="button"
              disabled={issues.length > 0 || pending}
              onClick={copyFromOperation}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
              Copiar e abrir
            </Button>
          ) : step === "resumo" ? (
            <Button
              type="button"
              disabled={!canSubmit(draft) || pending}
              onClick={generate}
            >
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Gerar orçamento
            </Button>
          ) : (
            <Button
              type="button"
              disabled={issues.length > 0 || pending}
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

/**
 * Onde a pessoa está, e o que já dá para revisitar.
 *
 * Voltar é livre; pular à frente, não — um passo adiante depende do anterior
 * estar completo, e deixar pular produziria um resumo de um rascunho pela metade.
 */
function Progress({
  current,
  draft,
  onJump,
}: {
  current: number;
  draft: QuoteDraft;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-1.5">
      {WIZARD_STEPS.map((step, index) => {
        const done = index < current && stepIssues(step, draft).length === 0;
        const active = index === current;
        return (
          <li key={step}>
            <button
              type="button"
              disabled={index > current}
              onClick={() => onJump(index)}
              className={cn(
                "rounded-full px-3 py-1 text-xs transition-colors",
                active && "bg-primary text-primary-foreground",
                !active && done && "bg-surface-strong text-foreground",
                !active && !done && "text-muted-foreground",
                index <= current && !active && "hover:bg-accent",
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

/**
 * A falha da criação em quatro requisições.
 *
 * Quando a proposta já foi criada, o erro diz em que passo parou e oferece
 * abri-la — porque o que ficou é um `DRAFT` editável, e mandar a pessoa
 * recomeçar do zero depois de gravar sete itens seria perder trabalho que existe.
 */
function SubmitError({ error }: { error: unknown }) {
  if (!(error instanceof QuoteWizardFailure)) {
    return <MutationError error={error} />;
  }

  const href = error.quoteId ? entityHref("quote", error.quoteId) : null;

  return (
    <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
      <p className="text-sm text-destructive">{error.message}</p>
      <MutationError error={error.cause} />
      {href ? (
        <p className="text-xs text-muted-foreground">
          A proposta ficou salva como rascunho com o que já entrou.{" "}
          <a href={href} className="underline">
            Abrir para continuar
          </a>{" "}
          — não é preciso refazer.
        </p>
      ) : null}
    </div>
  );
}
