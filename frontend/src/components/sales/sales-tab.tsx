"use client";

import { useState } from "react";
import { Download, Plus, ReceiptText, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { queryKeys } from "@/api/query-keys";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelLoading } from "@/components/panels";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiResource, usePaginatedQuery } from "@/hooks/api/use-api-query";
import { useActiveScope } from "@/providers/use-active-scope";
import { useSignedUrlLifecycle } from "@/hooks/documents/use-signed-url";
import {
  PAYMENT_METHODS,
  receiptPending,
  saleMoney,
  type Sale,
  type SaleInput,
} from "./sale-model";
import { SaleWizard } from "./sale-wizard";

export function SalesTab() {
  const { organizationId, businessUnitId, businessUnit } = useActiveScope();
  if (!businessUnitId)
    return (
      <p className="rounded-lg border p-5 text-sm">
        Selecione uma unidade no menu superior para consultar e registrar
        vendas.
      </p>
    );

  return (
    <SalesWorkspace
      key={`${organizationId}:${businessUnitId}`}
      unitId={businessUnitId}
      unitName={businessUnit?.tradeName ?? businessUnit?.legalName}
    />
  );
}

function SalesWorkspace({
  unitId,
  unitName,
}: {
  unitId: string;
  unitName?: string;
}) {
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string>();
  const data = usePaginatedQuery<Sale>(
    queryKeys.list("sales", { unitId, page }),
    "/sales",
    { page, limit: 20 },
    {
      refetchInterval: (query) =>
        query.state.data?.data.some(receiptPending) ? 3_000 : false,
    },
  );
  const cache = useQueryClient();
  const create = useApiMutation<Sale, SaleInput>((input) =>
    apiClient.post("/sales", input),
  );
  const onCreate = async (input: SaleInput) => {
    const result = await create.mutateAsync(input);
    setPage(1);
    setCreating(false);
    setSelected(result.id);
    for (const resource of [
      "sales",
      "inventory",
      "catalog",
      "documents",
      "financial",
    ])
      void cache.invalidateQueries({ queryKey: queryKeys.module(resource) });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Vendas</h2>
          {unitName ? (
            <p className="text-sm text-muted-foreground">{unitName}</p>
          ) : null}
        </div>
        <Button
          onClick={() => {
            create.reset();
            setCreating(true);
          }}
        >
          <Plus className="size-4" /> Registrar venda
        </Button>
      </div>

      {data.isPending ? (
        <PanelLoading rows={4} />
      ) : data.error ? (
        <PanelError error={data.error} onRetry={() => void data.refetch()} />
      ) : data.data?.data.length ? (
        <>
          <div className="divide-y rounded-xl border">
            {data.data.data.map((sale) => (
              <button
                type="button"
                key={sale.id}
                onClick={() => setSelected(sale.id)}
                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-2"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <ReceiptText
                    className="hidden size-5 shrink-0 text-primary sm:block"
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {sale.customerName}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {sale.receipt.code} ·{" "}
                      {sale.paidOn.split("-").reverse().join("/")}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-sm font-semibold tabular-nums">
                    {saleMoney(sale.total)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {sale.receipt.renderStatus === "READY"
                      ? "Recibo disponível"
                      : receiptPending(sale)
                        ? "Gerando recibo"
                        : "Recibo pendente"}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {data.data.meta.totalPages > 1 ? (
            <div className="flex items-center justify-end gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Anterior
              </Button>
              <span>
                {page} de {data.data.meta.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.data.meta.totalPages}
                onClick={() => setPage(page + 1)}
              >
                Próxima
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <ReceiptText
            className="mx-auto mb-3 size-7 text-muted-foreground"
            aria-hidden
          />
          <p className="font-medium">Nenhuma venda registrada nesta unidade</p>
          <p className="mt-1 text-sm text-muted-foreground">
            As vendas confirmadas e seus recibos aparecem aqui.
          </p>
        </div>
      )}
      {creating ? (
        <SaleWizard
          unitId={unitId}
          unitName={unitName}
          pending={create.isPending}
          error={create.error}
          onClose={() => setCreating(false)}
          onSubmit={onCreate}
        />
      ) : null}
      {selected ? (
        <SaleDetails
          id={selected}
          unitId={unitId}
          onClose={() => setSelected(undefined)}
        />
      ) : null}
    </section>
  );
}

function SaleDetails({
  id,
  unitId,
  onClose,
}: {
  id: string;
  unitId: string;
  onClose: () => void;
}) {
  const path = `/sales/${id}`;
  const details = useApiResource<Sale>(
    queryKeys.query("sales", "receipt", { id, unitId }),
    path,
    undefined,
    {
      refetchInterval: (query) =>
        query.state.data && receiptPending(query.state.data) ? 2_500 : false,
    },
  );
  const sale = details.data;
  const download = useSignedUrlLifecycle(
    queryKeys.query("sales", "receipt-file", { id, unitId }),
    ({ signal }) => apiClient.get(`${path}/receipt/download`, { signal }),
    { enabled: sale?.receipt.renderStatus === "READY" },
  );
  const retry = useApiMutation<Sale, void>(
    () => apiClient.post(`${path}/receipt`, {}),
    {
      invalidate: [queryKeys.module("sales")],
    },
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {sale ? `Venda · ${sale.receipt.code}` : "Venda"}
          </DialogTitle>
          <DialogDescription>
            {sale?.customerName ?? "Resumo e recibo da venda"}
          </DialogDescription>
        </DialogHeader>
        {details.isPending ? <PanelLoading rows={3} /> : null}
        {details.error ? (
          <PanelError
            error={details.error}
            onRetry={() => void details.refetch()}
          />
        ) : null}
        {sale ? (
          <>
            <dl className="space-y-2 rounded-lg border p-3 text-sm">
              {sale.items.map((item) => (
                <div
                  key={item.productId}
                  className="flex justify-between gap-3"
                >
                  <dt>
                    {Number(item.quantity).toLocaleString("pt-BR")} {item.unit}{" "}
                    · {item.name}
                  </dt>
                  <dd className="shrink-0">{saleMoney(item.total)}</dd>
                </div>
              ))}
              {Number(sale.discount) > 0 ? (
                <div className="flex justify-between">
                  <dt>Desconto</dt>
                  <dd>− {saleMoney(sale.discount)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between border-t pt-2 font-semibold">
                <dt>Total recebido</dt>
                <dd>{saleMoney(sale.total)}</dd>
              </div>
            </dl>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {sale.payments.map((payment, index) => (
                <li key={index}>
                  {PAYMENT_METHODS[payment.method]} ·{" "}
                  {saleMoney(payment.amount)}
                  {payment.installments && payment.installments > 1
                    ? ` · ${payment.installments} parcelas`
                    : ""}
                </li>
              ))}
            </ul>
            {sale.notes ? (
              <p className="whitespace-pre-wrap text-sm">{sale.notes}</p>
            ) : null}
            {receiptPending(sale) ? (
              <p role="status" className="text-sm text-muted-foreground">
                O recibo está sendo gerado. O botão de download aparecerá quando
                o PDF estiver pronto.
              </p>
            ) : sale.receipt.renderStatus === "READY" ? (
              download.data ? (
                <Button asChild>
                  <a
                    href={download.data.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="size-4" /> Baixar recibo
                  </a>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={download.isFetching}
                  onClick={() => void download.refetch()}
                >
                  {download.isFetching
                    ? "Preparando PDF…"
                    : "Tentar baixar recibo"}
                </Button>
              )
            ) : (
              <Button
                disabled={retry.isPending}
                onClick={() => retry.mutate(undefined)}
                variant="outline"
              >
                <RefreshCw className="size-4" />
                {retry.isPending
                  ? "Solicitando…"
                  : "Tentar gerar recibo novamente"}
              </Button>
            )}
          </>
        ) : null}
        <MutationError error={download.error ?? retry.error} />
      </DialogContent>
    </Dialog>
  );
}
