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
import { BILLING_INTERVAL_LABELS } from "@/types/billing";

/** Quantas vezes reconsultar depois de voltar do provedor, e de quanto em quanto. */
const TENTATIVAS_APOS_CHECKOUT = 6;
const INTERVALO_DE_RECONSULTA_MS = 4000;

type Confirmacao =
  | { tipo: "CANCELAR" }
  | { tipo: "TROCAR"; planCode: string; intervalo: string };

export function SubscriptionSettingsTab() {
  const params = useSearchParams();
  const overview = useBillingOverview();
  const checkout = useCreateCheckout();
  const portal = useOpenBillingPortal();
  const cancelar = useCancelRenewal();
  const manter = useKeepSubscription();
  const trocar = useChangePlan();
  const desfazerTroca = useCancelScheduledChange();

  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);

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
    try {
      await acao();
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
  const aguardandoConfirmacao =
    voltouDoCheckout &&
    reconsultas < TENTATIVAS_APOS_CHECKOUT &&
    overview.data?.subscription?.status !== "ACTIVE";

  useEffect(() => {
    if (!aguardandoConfirmacao) return;
    const timer = setTimeout(() => {
      setReconsultas((atual) => atual + 1);
      void overview.refetch();
    }, INTERVALO_DE_RECONSULTA_MS);
    return () => clearTimeout(timer);
  }, [aguardandoConfirmacao, reconsultas, overview]);

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
      if (!confirmacao || !assinatura) return;
      if (confirmacao.tipo === "CANCELAR") {
        await cancelar.mutateAsync({ expectedVersion: assinatura.version });
      } else {
        await trocar.mutateAsync({
          expectedVersion: assinatura.version,
          planCode: confirmacao.planCode,
          billingInterval: confirmacao.intervalo,
        });
      }
      setConfirmacao(null);
    });

  return (
    <div className="space-y-6">
      {aguardandoConfirmacao ? (
        <p className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Estamos confirmando sua assinatura. Isso pode levar alguns instantes.
        </p>
      ) : null}

      <BillingBanner overview={dados} />

      <CurrentSubscriptionCard
        overview={dados}
        onCancelRenewal={() => setConfirmacao({ tipo: "CANCELAR" })}
        onKeepSubscription={() =>
          void proteger(async () => {
            if (!assinatura) return;
            await manter.mutateAsync({ expectedVersion: assinatura.version });
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

      <PlanCatalogSection
        overview={dados}
        onSubscribe={iniciarCheckout}
        onChangePlan={(planCode, intervalo) =>
          setConfirmacao({ tipo: "TROCAR", planCode, intervalo })
        }
        pending={checkout.isPending || comandoPendente}
      />

      <ConfirmacaoDialog
        confirmacao={confirmacao}
        overview={dados}
        pending={comandoPendente}
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
  onCancel,
  onConfirm,
}: {
  confirmacao: Confirmacao | null;
  overview: NonNullable<ReturnType<typeof useBillingOverview>["data"]>;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const assinatura = overview.subscription;
  if (!confirmacao || !assinatura) return null;

  if (confirmacao.tipo === "CANCELAR") {
    return (
      <AlertDialog open onOpenChange={(aberto) => !aberto && onCancel()}>
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
  const atual = overview.catalog.plans.find(
    (item) => item.code === assinatura.planCode,
  );
  /**
   * Subir ou descer, decidido pelo preço de tabela **publicado**.
   *
   * É só para escolher a explicação. Quem decide se a mudança é imediata ou
   * programada é o servidor, e a tela não muda nada por conta disso.
   */
  const subindo =
    (destino?.prices.MONTHLY?.amountMinor ?? 0) >
    (atual?.prices.MONTHLY?.amountMinor ?? 0);

  return (
    <AlertDialog open onOpenChange={(aberto) => !aberto && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Mudar para {destino?.label ?? "outro plano"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {subindo ? (
              <>
                A mudança vale imediatamente. A diferença de cobrança é
                calculada pelo provedor de pagamento.
              </>
            ) : (
              <>
                A mudança será aplicada no próximo período de cobrança, em{" "}
                {formatDate(assinatura.billingPeriod.end)}. Até lá, nada muda —
                e nenhum recurso é removido.
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
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            Confirmar mudança
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
