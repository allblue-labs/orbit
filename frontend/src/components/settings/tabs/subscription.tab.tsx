"use client";

/**
 * Plano e assinatura.
 *
 * ## Nada é decidido aqui
 *
 * Preço, ações permitidas, elegibilidade de avaliação, limites e datas chegam
 * prontos do servidor. Esta aba compõe três blocos — assinatura atual, uso e
 * planos — e encaminha comandos.
 *
 * ## Voltar do provedor não ativa nada
 *
 * `?assinatura=sucesso` só diz que o navegador voltou. Quem confirma o
 * pagamento é o provedor, por evento assinado, e o estado real chega na
 * próxima leitura. Enquanto ela não confirma, a tela diz que está
 * confirmando — nunca que está ativa.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { useSession } from "@/providers/session-provider";
import { Button } from "@/components/ui/button";
import {
  clearBillingTarget,
  readBillingTarget,
  rememberBillingTarget,
} from "@/components/billing/billing-redirect";

import { CurrentSubscriptionCard } from "@/components/billing/current-subscription.card";
import { BillingInvoiceHistory } from "@/components/billing/billing-invoice-history";
import { PlanCatalogSection } from "@/components/billing/plan-catalog.section";
import { PlanUsageSection } from "@/components/billing/plan-usage.section";
import { PanelError, PanelLoading } from "@/components/panels";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useBillingOverview,
  useCancelScheduledChange,
  useCancelRenewal,
  useChangePlan,
  useCreateCheckout,
  useKeepSubscription,
  useOpenBillingPortal,
} from "@/hooks/billing/use-billing";

import { useDateFormatters } from "@/hooks/use-date-formatters";
import { notifySuccess } from "@/lib/notify";
import { diasAte } from "@/components/billing/billing-format";
import { BILLING_INTERVAL_LABELS, type BillingOverview } from "@/types/billing";

/** Quantas vezes reconsultar depois de voltar do provedor, e de quanto em quanto. */
const TENTATIVAS_APOS_CHECKOUT = 6;
const INTERVALO_DE_RECONSULTA_MS = 4000;

type Confirmacao =
  | { tipo: "CANCELAR" }
  | {
      tipo: "TROCAR";
      planCode: string;
      intervalo: string;
      catalogVersion?: number;
    };

function paidPlanChange(
  overview: BillingOverview,
  target: Extract<Confirmacao, { tipo: "TROCAR" }>,
) {
  const current = overview.subscription;
  if (current?.status !== "ACTIVE") return null;
  if (
    current.billingInterval !== "MONTHLY" ||
    target.intervalo !== "MONTHLY" ||
    overview.contractedAmountMinor == null
  ) return "SUPPORT";
  const price = overview.catalog.plans.find((plan) => plan.code === target.planCode)?.prices.MONTHLY;
  if (!price) return "SUPPORT";
  return price.amountMinor > overview.contractedAmountMinor ? "UPGRADE" : "SCHEDULED";
}

export function SubscriptionSettingsTab() {
  const { formatDate } = useDateFormatters();
  const params = useSearchParams();
  const { refresh: refreshSession } = useSession();
  const overview = useBillingOverview();
  const checkout = useCreateCheckout();
  const portal = useOpenBillingPortal();
  const cancelar = useCancelRenewal();
  const manter = useKeepSubscription();
  const trocar = useChangePlan();
  const desfazerTroca = useCancelScheduledChange();

  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  /**
   * Trava de mesmo tique.
   *
   * `disabled` só vale no próximo render: dois cliques no mesmo tique passam
   * pelos dois. Aqui o segundo encontra a trava já erguida — a mesma lição da
   * PR-FE-H03.
   */
  const emVoo = useRef(false);
  const proteger = useCallback(async (acao: () => Promise<unknown>) => {
    if (emVoo.current) return;
    emVoo.current = true;
    setActionError(null);
    try {
      await acao();
    } catch (error) {
      setActionError(error);
    } finally {
      emVoo.current = false;
    }
  }, []);

  /**
   * De volta do provedor.
   *
   * A confirmação chega por webhook, não pelo navegador. A tela reconsulta
   * algumas vezes e para: ficar consultando para sempre gastaria a bateria de
   * quem deixou a aba aberta sem nunca decidir nada.
   */
  const voltouDoCheckout = params.get("assinatura") === "sucesso";
  const [reconsultas, setReconsultas] = useState(0);
  const [destinoEsperado, setDestinoEsperado] = useState(readBillingTarget);
  const assinaturaRecebida = overview.data?.subscription;
  const confirmou =
    assinaturaRecebida?.status === "ACTIVE" &&
    (!destinoEsperado ||
      (assinaturaRecebida.id === destinoEsperado.subscriptionId &&
        assinaturaRecebida.planCode === destinoEsperado.planCode &&
        assinaturaRecebida.billingInterval ===
          destinoEsperado.billingInterval));
  const aguardandoConfirmacao =
    (voltouDoCheckout || !!destinoEsperado) && reconsultas < TENTATIVAS_APOS_CHECKOUT && !confirmou;

  useEffect(() => {
    if (!aguardandoConfirmacao) return;
    const timer = setTimeout(() => {
      setReconsultas((atual) => atual + 1);
      void overview.refetch().then(() => refreshSession());
    }, INTERVALO_DE_RECONSULTA_MS);
    return () => clearTimeout(timer);
  }, [aguardandoConfirmacao, reconsultas, overview, refreshSession]);

  useEffect(() => {
    if ((voltouDoCheckout || destinoEsperado) && confirmou) {
      clearBillingTarget();
      void refreshSession();
    }
  }, [voltouDoCheckout, destinoEsperado, confirmou, refreshSession]);

  if (overview.isPending) return <PanelLoading rows={6} />;
  if (overview.error) {
    return (
      <PanelError
        error={overview.error}
        onRetry={() => void overview.refetch()}
      />
    );
  }
  if (!overview.data) return <PanelLoading rows={6} />;

  const dados = overview.data;
  const assinatura = dados.subscription;
  const comandoPendente =
    cancelar.isPending ||
    manter.isPending ||
    trocar.isPending ||
    desfazerTroca.isPending;

  const iniciarCheckout = (planCode: string, intervalo: string) =>
    void proteger(async () => {
      const sessao = await checkout.mutateAsync({
        planCode,
        expectedCatalogVersion: dados.catalog.plans.find(
          (plan) => plan.code === planCode,
        )?.version,
        billingInterval: intervalo,
      });
      if (assinatura)
        rememberBillingTarget({
          subscriptionId: sessao.subscriptionId ?? assinatura.id,
          planCode,
          billingInterval: intervalo,
        });
      /** A URL é a que o servidor devolveu. O cliente não monta endereço. */
      window.location.assign(sessao.url);
    });

  const abrirPortal = () =>
    void proteger(async () => {
      const sessao = await portal.mutateAsync();
      window.location.assign(sessao.url);
    });

  const executarConfirmacao = () =>
    void proteger(async () => {
      if (!confirmacao || !assinatura)
        throw new Error("Atualize a página e selecione o plano novamente.");
      if (confirmacao.tipo === "CANCELAR") {
        const { cancellation } = await cancelar.mutateAsync({
          expectedVersion: assinatura.version,
          acknowledgeDataDeletion: true,
        });
        if (cancellation.kind === "REFUND_REQUESTED")
          setActionMessage("Recebemos sua solicitação de cancelamento com estorno integral. O prazo para o valor aparecer depende do seu meio de pagamento.");
        if (cancellation.kind === "SUPPORT_TICKET")
          setActionMessage(`Chamado ${cancellation.ticketId} aberto para análise da equipe de suporte.`);
      } else {
        const sessao = await trocar.mutateAsync({
          expectedVersion: assinatura.version,
          planCode: confirmacao.planCode,
          expectedCatalogVersion: confirmacao.catalogVersion,
          billingInterval: confirmacao.intervalo,
          acknowledgeTrialEnd: assinatura.status === "TRIALING",
          acknowledgeImmediateCharge: paidPlanChange(dados, confirmacao) === "UPGRADE",
        });
        if ("kind" in sessao) {
          if (sessao.kind === "SUPPORT_TICKET") {
            setActionMessage(`Chamado ${sessao.ticketId} aberto para a equipe analisar a troca de plano.`);
            setConfirmacao(null);
            return;
          }
          if (sessao.kind === "UPGRADE_PROCESSING") {
            const target = {
              subscriptionId: assinatura.id,
              planCode: confirmacao.planCode,
              billingInterval: confirmacao.intervalo,
            };
            rememberBillingTarget(target);
            setDestinoEsperado(target);
            setReconsultas(0);
            setActionMessage(null);
            setConfirmacao(null);
            return;
          }
          setActionMessage(
            sessao.kind === "TRIAL_STARTED"
              ? `Seu teste gratuito começou e vai até ${formatDate(sessao.endsAt)}. Nenhuma cobrança foi realizada.`
              : `Troca agendada para ${formatDate(sessao.effectiveAt)}. Seu plano e seus créditos atuais continuam até essa data.`,
          );
          if (sessao.kind === "TRIAL_STARTED")
            notifySuccess(
              "Seu teste gratuito começou",
              `Você tem acesso gratuito até ${formatDate(sessao.endsAt)}. Nenhuma cobrança foi realizada.`,
            );
          clearBillingTarget();
          await overview.refetch();
          await refreshSession();
          setConfirmacao(null);
          return;
        }
        rememberBillingTarget({
          subscriptionId: assinatura.id,
          planCode: confirmacao.planCode,
          billingInterval: confirmacao.intervalo,
        });
        window.location.assign(sessao.url);
      }
      setConfirmacao(null);
    });

  return (
    <div className="space-y-6">
      {!confirmacao ? <MutationError error={actionError} /> : null}
      {dados.refundRequestStatus === "OPEN" && !actionMessage ? (
        <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          Seu cancelamento com estorno está sendo processado.
        </p>
      ) : null}
      {dados.refundRequestStatus === "REVIEW" && !actionMessage ? (
        <p role="status" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          A equipe de suporte está acompanhando sua solicitação de estorno.
        </p>
      ) : null}
      {actionMessage ? (
        <p
          role="status"
          className="rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm"
        >
          {actionMessage}
        </p>
      ) : null}
      {assinatura?.status === "PENDING_PAYMENT" ? (
        <div
          role="status"
          className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-4 text-sm"
        >
          <p className="font-medium">
            Seu cadastro está concluído. Falta finalizar o pagamento.
          </p>
          <p className="text-muted-foreground">
            O plano será liberado após a confirmação do Stripe. Você pode
            retomar o pagamento abaixo ou escolher outro plano.
          </p>
          {dados.billing.canCheckout ? (
            <Button
              onClick={() =>
                iniciarCheckout(assinatura.planCode, assinatura.billingInterval)
              }
              disabled={checkout.isPending || comandoPendente}
            >
              {checkout.isPending
                ? "Abrindo pagamento…"
                : "Continuar para o pagamento"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {aguardandoConfirmacao ? (
        <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Estamos confirmando sua assinatura. Isso pode levar alguns instantes.
        </p>
      ) : null}
      {(voltouDoCheckout || destinoEsperado) && !confirmou && !aguardandoConfirmacao ? (
        <p
          role="status"
          className="rounded-md border border-border p-3 text-sm"
        >
          Ainda aguardamos a confirmação do pagamento. Seu plano será atualizado
          assim que o Stripe confirmar.{" "}
          <button
            type="button"
            className="underline"
            onClick={() => {
              setReconsultas(0);
              void overview.refetch();
            }}
          >
            Verificar novamente
          </button>
        </p>
      ) : null}

      <RetentionBanner overview={dados} />
      <BillingBanner overview={dados} />

      {assinatura?.status !== "PENDING_PAYMENT" ? (
        <>
          <CurrentSubscriptionCard
            overview={dados}
            onCancelRenewal={() => setConfirmacao({ tipo: "CANCELAR" })}
            onKeepSubscription={() =>
              void proteger(async () => {
                if (!assinatura) return;
                await manter.mutateAsync({
                  expectedVersion: assinatura.version,
                });
              })
            }
            onCancelScheduledChange={() =>
              void proteger(async () => {
                if (!assinatura) return;
                await desfazerTroca.mutateAsync({
                  expectedVersion: assinatura.version,
                });
              })
            }
            onOpenPortal={abrirPortal}
            portalPending={portal.isPending}
            commandPending={comandoPendente}
          />

          <PlanUsageSection entitlements={dados.entitlements} />

          <BillingInvoiceHistory invoices={dados.invoices} />
        </>
      ) : null}

      <PlanCatalogSection
        overview={dados}
        onSubscribe={iniciarCheckout}
        onChangePlan={(planCode, intervalo) => {
          setActionError(null);
          setConfirmacao({
            tipo: "TROCAR",
            planCode,
            intervalo,
            catalogVersion: dados.catalog.plans.find(
              (plan) => plan.code === planCode,
            )?.version,
          });
        }}
        pending={checkout.isPending || comandoPendente}
      />

      <ConfirmacaoDialog
        confirmacao={confirmacao}
        overview={dados}
        pending={comandoPendente}
        error={actionError}
        onCancel={() => setConfirmacao(null)}
        onConfirm={executarConfirmacao}
      />
    </div>
  );
}

/**
 * O aviso do topo, quando há o que avisar.
 *
 * Cobrança pendente e suspensão precisam de explicação e de caminho de saída —
 * um selo pequeno no cartão não daria conta. Erro do provedor não vira texto
 * técnico: o código público já traz a mensagem certa.
 */
function RetentionBanner({
  overview,
}: {
  overview: NonNullable<ReturnType<typeof useBillingOverview>["data"]>;
}) {
  const { formatDate, formatDateTime } = useDateFormatters();
  const subscription = overview.subscription;
  const deadline =
    overview.dataRetentionEndsAt ?? subscription?.dataRetentionEndsAt;
  const active =
    subscription?.status === "ACTIVE" || subscription?.status === "TRIALING";
  if (overview.dataPurgedAt && !active)
    return (
      <div
        role="status"
        className="rounded-xl border border-border bg-muted/40 p-4 text-sm"
      >
        <p className="font-semibold">
          Os dados operacionais anteriores foram excluídos
        </p>
        <p className="mt-1 text-muted-foreground">
          O prazo de retorno terminou. Uma nova contratação começa com a base
          operacional vazia. Os registros mínimos de conta, aceite e cobrança
          permanecem separados.
        </p>
      </div>
    );
  if (!deadline) return null;
  return (
    <div
      role="status"
      className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm"
    >
      <p className="font-semibold">
        {active
          ? "Renovação cancelada; seu período continua disponível"
          : "Escolha um plano para continuar com seus dados"}
      </p>
      <p>
        {active
          ? `Seu plano e seus limites continuam até ${formatDate(subscription!.billingPeriod.end)}. Não haverá renovação automática.`
          : "O acesso operacional terminou. Você pode recontratar e continuar com a mesma organização."}
      </p>
      <p>
        Os dados operacionais ficam preservados por 30 dias após o fim do acesso
        pago. Sem recontratação, a exclusão pode ocorrer a partir de{" "}
        <strong>{formatDateTime(deadline)}</strong>, quando a rotina de exclusão
        estiver ativa. A nova contratação precisa ter o pagamento confirmado
        antes de a exclusão começar.
      </p>
    </div>
  );
}

function BillingBanner({
  overview,
}: {
  overview: ReturnType<typeof useBillingOverview>["data"] & object;
}) {
  const status = overview.subscription?.status;
  if (status !== "GRACE_PERIOD" && status !== "SUSPENDED") return null;

  const suspensa = status === "SUSPENDED";
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-md border border-border bg-muted/40 p-4"
    >
      <AlertTriangle className="mt-0.5 size-5 text-amber-600" aria-hidden />
      <div className="space-y-1 text-sm">
        <p className="font-medium">
          {suspensa
            ? "Sua assinatura está suspensa."
            : "Identificamos um problema com a cobrança."}
        </p>
        <p className="text-muted-foreground">
          {suspensa
            ? "Regularize a cobrança para restaurar o acesso completo."
            : "Você continua com acesso durante o período de regularização."}
        </p>
      </div>
    </div>
  );
}

function ConfirmacaoDialog({
  confirmacao,
  overview,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  confirmacao: Confirmacao | null;
  overview: NonNullable<ReturnType<typeof useBillingOverview>["data"]>;
  pending: boolean;
  error: unknown;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { formatDate } = useDateFormatters();
  const assinatura = overview.subscription;
  if (!confirmacao || !assinatura) return null;

  if (confirmacao.tipo === "CANCELAR") {
    return (
      <AlertDialog
        open
        onOpenChange={(aberto) => !aberto && !pending && onCancel()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar sua assinatura?</AlertDialogTitle>
            <AlertDialogDescription>
              Em até 7 dias da contratação, o cancelamento é imediato e
              você pode receber o valor pago integralmente. Após esse prazo, a
              equipe recebe um chamado para análise e o acesso pago permanece
              até {formatDate(assinatura.billingPeriod.end)}. Seus dados
              operacionais são mantidos por 30 dias a partir do fim do acesso.
              Depois desse período, os dados podem ser excluídos quando a rotina
              de exclusão estiver ativa, se não houver recontratação.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <MutationError error={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Voltar</AlertDialogCancel>
            <Button type="button" onClick={onConfirm} disabled={pending}>
              Confirmar cancelamento
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const destino = overview.catalog.plans.find(
    (item) => item.code === confirmacao.planCode,
  );
  const encerraTeste = assinatura.status === "TRIALING";
  const diasDeTeste = destino?.trialDays ?? 0;
  const iniciaTeste =
    assinatura.status === "PENDING_PAYMENT" &&
    diasDeTeste > 0 &&
    overview.billing.canStartTrial === true;
  const paidChange = paidPlanChange(overview, confirmacao);
  const diasRestantes = diasAte(
    assinatura.trial?.endsAt ?? assinatura.billingPeriod.end,
  );

  return (
    <AlertDialog
      open
      onOpenChange={(aberto) => !aberto && !pending && onCancel()}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Mudar para {destino?.label ?? "outro plano"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {iniciaTeste ? (
              <>
                Você tem direito a {diasDeTeste} dias gratuitos em{" "}
                {destino?.label}. O teste começa agora, sem pagamento e sem
                perder dias. Ao final, será necessário contratar para continuar.
              </>
            ) : paidChange === "SUPPORT" ? (
              <>
                A equipe de suporte vai analisar a mudança. Você receberá um
                número para acompanhar a solicitação. Seu contrato atual segue vigente.
              </>
            ) : paidChange === "UPGRADE" ? (
              <>
                Você autoriza a cobrança de um novo ciclo de{" "}
                {destino?.prices.MONTHLY?.formatted}, com desconto proporcional
                pelo tempo já pago que restar no plano atual. A cobrança usa
                o meio de pagamento cadastrado e pode exigir confirmação no Stripe.
                Os novos recursos ficam disponíveis após a confirmação.
              </>
            ) : paidChange === "SCHEDULED" ? (
              <>
                Seu plano, créditos e limites atuais continuam até{" "}
                {formatDate(assinatura.billingPeriod.end)}. O novo valor será
                cobrado somente na renovação, quando os novos limites entram em
                vigor. Se houver excedentes, você terá 48 horas para
                regularizar. Depois, os recursos afetados serão bloqueados até a
                adequação. Seus dados serão preservados.
              </>
            ) : encerraTeste ? (
              <>
                Ao concluir o pagamento de {destino?.label ?? "outro plano"},
                seu teste termina e você perde os {diasRestantes} dias gratuitos
                restantes, sem transferência para o novo plano. A cobrança
                começa agora.
              </>
            ) : (
              <>
                Você será direcionado ao Stripe para conferir os valores,
                eventuais créditos e confirmar a mudança. O novo plano será
                liberado após a confirmação do pagamento.
              </>
            )}
            {paidChange !== "SUPPORT" && confirmacao.intervalo !== assinatura.billingInterval ? (
              <>
                {" "}
                A periodicidade passará a ser{" "}
                {BILLING_INTERVAL_LABELS[
                  confirmacao.intervalo
                ]?.toLowerCase() ?? "outra"}
                .
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {encerraTeste ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
            Se desistir ou cancelar o pagamento, seu plano e os dias de teste
            continuam como estão.
          </p>
        ) : null}
        <MutationError error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Voltar</AlertDialogCancel>
          <Button type="button" onClick={onConfirm} disabled={pending}>
            {pending
              ? "Processando…"
              : iniciaTeste
                ? `Começar ${diasDeTeste} dias grátis`
                : paidChange === "SUPPORT"
                  ? "Abrir chamado"
                  : paidChange === "UPGRADE"
                    ? "Autorizar cobrança"
                    : paidChange === "SCHEDULED"
                      ? "Agendar mudança na renovação"
                      : "Continuar para o pagamento"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
