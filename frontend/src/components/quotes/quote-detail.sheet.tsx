"use client";

/**
 * Resumo da proposta, ao clicar na linha.
 *
 * ## Painel, e a página continua existindo
 *
 * O painel responde "o que é esta proposta" sem sair da lista — é o que se
 * pergunta ao percorrer vinte linhas cobrando decisão. Trabalhar nela é outra
 * coisa: acrescentar item, renegociar preço, converter em operação. Isso mora na
 * página, que tem rota própria, sobrevive a recarregar e pode ser enviada a
 * alguém. O painel leva para lá em vez de repetir aquilo aqui.
 *
 * ## Os itens vêm de uma segunda consulta
 *
 * A listagem publica `QuoteSummary`, que **não** tem `items` — vinte propostas
 * com todos os itens de cada uma é um payload que ninguém pediu. Ao abrir, o
 * painel busca o detalhe. Enquanto ele não chega, o que a linha já sabe é o que
 * aparece, em vez de um esqueleto onde já havia informação.
 */
import { ArrowUpRight, FileDown, Loader2, Package } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityBadge, EntityLink } from "@/entities";
import { useQuote, useQuoteDocument } from "@/hooks/quotes/use-quotes";
import type { QuoteSummary } from "@/types/quotes";
import { Money, Quantity, ValidUntil } from "./quote-presentation";

export function QuoteDetailSheet({
  quote,
  onOpenChange,
}: {
  /** A linha clicada. `null` fecha o painel. */
  quote: QuoteSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={quote !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {quote ? <Body summary={quote} /> : null}
      </SheetContent>
    </Sheet>
  );
}

function Body({ summary }: { summary: QuoteSummary }) {
  /* O detalhe traz os itens, que a listagem não publica. */
  const detail = useQuote(summary.id);
  const download = useQuoteDocument(summary.id);

  /* Enquanto o detalhe não chega, vale o que a linha já sabia. */
  const quote = detail.data ?? summary;
  const items = detail.data?.items ?? [];

  return (
    <>
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2">
          {quote.code}
          <EntityBadge entity="quote" group="status" value={quote.status} />
        </SheetTitle>
        <SheetDescription>{quote.title}</SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-4 pb-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Entry label="Cliente">{quote.customer.displayName}</Entry>
          <Entry label="Responsável">
            {quote.responsible?.displayName ?? "—"}
          </Entry>
          <Entry label="Vencimento">
            <ValidUntil quote={quote} />
          </Entry>
          <Entry label="Valor total">
            <Money value={quote.total} />
          </Entry>
          <Entry label="Endereço" full>
            {quote.serviceAddress?.summary ?? "—"}
          </Entry>
        </dl>

        {quote.assets.length > 0 ? (
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
              <Package className="size-3.5" aria-hidden />
              Equipamentos
            </h3>
            <ul className="space-y-1.5">
              {quote.assets.map((asset) => (
                <li
                  key={asset.id}
                  className="flex flex-wrap items-baseline gap-2 text-sm"
                >
                  <span>{asset.name}</span>
                  {asset.identifier ? (
                    <Badge variant="outline" className="font-mono text-xs">
                      {asset.identifier}
                    </Badge>
                  ) : null}
                  {asset.location ? (
                    <span className="text-xs text-muted-foreground">
                      {asset.location}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="text-xs font-medium text-muted-foreground uppercase">
            Itens
          </h3>
          <Items
            items={items}
            /* `itemCount` é da linha e já está certo; a lista pode ainda estar
               carregando. Sem essa distinção, uma proposta com três itens
               pareceria vazia por um instante. */
            expected={quote.itemCount}
            isPending={detail.isPending}
          />
        </section>

        <dl className="grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
          <Entry label="Subtotal">
            <Money value={quote.subtotal} muted />
          </Entry>
          <Entry label="Desconto">
            <Money value={quote.discount} muted />
          </Entry>
          <Entry label="Total">
            <Money value={quote.total} />
          </Entry>
        </dl>

        {quote.closingReason ? (
          <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
            <strong className="font-medium">Motivo do encerramento:</strong>{" "}
            {quote.closingReason}
          </p>
        ) : null}

        <MutationError error={download.error} />

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {/* `EntityLink` resolve a rota pelo registry e vira texto quando a
              entidade não tem página — aqui tem, mas montar o href à mão
              duplicaria a decisão que o registry já tomou. */}
          <Button asChild size="sm">
            <EntityLink entity="quote" id={quote.id}>
              <ArrowUpRight className="size-4" />
              Abrir a proposta
            </EntityLink>
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={download.isPending}
            onClick={() => download.mutate(undefined)}
          >
            {download.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <FileDown className="size-4" />
            )}
            Baixar PDF
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">
          Enviar, aprovar, recusar e converter acontecem na proposta aberta —
          cada uma registra algo diferente, e um painel de resumo não é onde se
          decide um negócio.
        </p>
      </div>
    </>
  );
}

function Items({
  items,
  expected,
  isPending,
}: {
  items: readonly {
    id: string;
    description: string;
    quantity: string;
    unit: string;
    total: string;
  }[];
  expected: number;
  isPending: boolean;
}) {
  if (items.length === 0) {
    if (isPending && expected > 0) {
      return (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Carregando {expected} {expected === 1 ? "item" : "itens"}…
        </p>
      );
    }
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum item. Uma proposta sem item não pode ser enviada.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Descrição</TableHead>
            <TableHead className="text-right">Qtd.</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="max-w-[18rem] truncate">
                {item.description}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                <Quantity value={item.quantity} /> {item.unit}
              </TableCell>
              <TableCell className="text-right">
                <Money value={item.total} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function Entry({
  label,
  children,
  full = false,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "min-w-0 sm:col-span-2" : "min-w-0"}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}
