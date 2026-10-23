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
  AlertDialogAction,
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
import { formatDate } from "@/lib/formatters";
import { diasAte } from "@/components/billing/billing-format";
import { BILLING_INTERVAL_LABELS } from "@/types/billing";

/** Quantas vezes reconsultar depois de voltar do provedor, e de quanto em quanto. */
const TENTATIVAS_APOS_CHECKOUT = 6;
const INTERVALO_DE_RECONSULTA_MS = 4000;

type Confirmacao =
  | { tipo: "CANCELAR" }
  | { tipo: "TROCAR"; planCode: string; intervalo: string };

export function SubscriptionSettingsTab() {
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
  const [destinoEsperado] = useState(readBillingTarget);
  const assinaturaRecebida = overview.data?.subscription;
  const confirmou =
    assinaturaRecebida?.status === "ACTIVE" &&
    (!destinoEsperado ||
      (assinaturaRecebida.id === destinoEsperado.subscriptionId &&
        assinaturaRecebida.planCode === destinoEsperado.planCode &&
        assinaturaRecebida.billingInterval ===
          destinoEsperado.billingInterval));
  const aguardandoConfirmacao =
    voltouDoCheckout && reconsultas < TENTATIVAS_APOS_CHECKOUT && !confirmou;

  useEffect(() => {
    if (!aguardandoConfirmacao) return;
    const timer = setTimeout(() => {
      setReconsultas((atual) => atual + 1);
      void overview.refetch().then(() => refreshSession());
    }, INTERVALO_DE_RECONSULTA_MS);
    return () => clearTimeout(timer);
  }, [aguardandoConfirmacao, reconsultas, overview, refreshSession]);

  useEffect(() => {
    if (voltouDoCheckout && confirmou) {
      clearBillingTarget();
      void refreshSession();
    }
  }, [voltouDoCheckout, confirmou, refreshSession]);

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
        billingInterval: intervalo,
      });
      if (assinatura)
        rememberBillingTarget({
          subscriptionId: assinatura.id,
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
        await cancelar.mutateAsync({ expectedVersion: assinatura.version });
      } else {
        const sessao = await trocar.mutateAsync({
          expectedVersion: assinatura.version,
          planCode: confirmacao.planCode,
          billingInterval: confirmacao.intervalo,
          acknowledgeTrialEnd: assinatura.status === "TRIALING",
        });
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
      {voltouDoCheckout && !confirmou && !aguardandoConfirmacao ? (
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
          setConfirmacao({ tipo: "TROCAR", planCode, intervalo });
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
            <AlertDialogTitle>Cancelar a renovação?</AlertDialogTitle>
            <AlertDialogDescription>
              Sua assinatura continuará ativa até{" "}
              {formatDate(assinatura.billingPeriod.end)}. Depois dessa data, ela
              não será renovada. Você pode voltar atrás enquanto o período
              corre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <MutationError error={error} />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm} disabled={pending}>
              Cancelar renovação
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  const destino = overview.catalog.plans.find(
    (item) => item.code === confirmacao.planCode,
  );
  const encerraTeste = assinatura.status === "TRIALING";
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
            {encerraTeste ? (
              <>
                O teste gratuito de 30 dias está disponível apenas no Essencial.
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
            {confirmacao.intervalo !== assinatura.billingInterval ? (
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
            {pending ? "Abrindo pagamento…" : "Continuar para o pagamento"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
