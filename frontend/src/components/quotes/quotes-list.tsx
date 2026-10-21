"use client";

/**
 * Listagem de propostas.
 *
 * ## A situação é filtro, e não aba
 *
 * Eram cinco abas chamando o **mesmo endpoint** com `status` diferente — e uma
 * delas, "Encerrados", precisava de um seletor próprio dentro de si para
 * escolher entre recusa, expiração e cancelamento, porque `QuoteQueryDto` aceita
 * uma situação por consulta. Duas camadas de navegação para responder uma
 * pergunta que a barra de filtros já responde.
 *
 * Hoje a situação é um filtro entre os outros, com as seis opções no mesmo
 * nível. `QuoteQueryDto` continua aceitando uma por consulta, e isso agora
 * aparece como é: escolher "Recusadas" mostra recusadas, não "encerradas".
 * Juntar as três no cliente quebraria paginação e contagem.
 *
 * ## Nada é recortado aqui
 *
 * Todo filtro é parâmetro do contrato, `meta.total` é do servidor, e os
 * valores da linha vêm calculados. A tela não soma coluna.
 *
 * ## A linha abre um resumo; a proposta tem página
 *
 * Clicar abre o painel, que responde "o que é esta proposta" sem sair da lista.
 * O código continua sendo link para a página, onde se trabalha nela — e o painel
 * leva para lá. Duas portas para dois usos, não duas telas para o mesmo.
 *
 * ## Equipamentos cabem na linha; itens não
 *
 * `QuoteSummary` publica `assets` e **não** `items`. São poucos equipamentos por
 * proposta, e "quais aparelhos" é a primeira pergunta de quem lê um orçamento de
 * manutenção. Os itens só o detalhe carrega.
 */
import { useState } from "react";
import { Plus, ReceiptText } from "lucide-react";

import { CustomerPicker } from "@/components/customers/customer-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAction } from "@/actions";
import { EntityBadge, EntityLink } from "@/entities";
import { useQuotes } from "@/hooks/quotes/use-quotes";
import { useActiveScope } from "@/providers/use-active-scope";
import { cn } from "@/lib/utils";
import {
  QUOTE_STATUS_LABELS,
  type QuoteQuery,
  type QuoteStatus,
  type QuoteSummary,
} from "@/types/quotes";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  optionsFrom,
  useListController,
} from "@/workspace";
import { Money, ValidUntil } from "./quote-presentation";
import { quotesEmptyCopy } from "./quotes-empty-state";
import { QuoteDetailSheet } from "./quote-detail.sheet";
import { QuoteWizardDialog } from "./wizard/quote-wizard.dialog";
import { QuoteRowActions } from "./quote-row-actions";

/**
 * As seis situações, na ordem do ciclo de vida da proposta.
 *
 * Elaboração, envio e aprovação são o caminho; recusa, expiração e cancelamento
 * são os três desfechos que o encerram sem virar trabalho. Ficam no mesmo
 * seletor porque são a mesma pergunta — e distintas entre si porque recusa é
 * decisão do cliente, expiração é prazo que passou e cancelamento é desistência
 * de quem propôs. Tratá-las como uma só apagaria a informação que mais falta
 * seis meses depois.
 */
const STATUS_OPTIONS = optionsFrom(
  ["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED", "CANCELLED"],
  QUOTE_STATUS_LABELS,
);

export function QuotesList({
  /**
   * Situação fixa, para quem embute a lista já recortada.
   *
   * Nenhuma tela passa hoje: o Financeiro mostra todas e deixa a escolha no
   * filtro. Fica como o recorte irmão de `customerId` — é assim que um painel
   * futuro mostra "as aprovadas" sem reimplementar tabela e paginação. Com ela
   * presente, o seletor de situação não aparece: a pergunta já está respondida.
   */
  status,
  /** Recorte por cliente — usado dentro do Customer Workspace. */
  customerId,
  emptyTitle,
  emptyDescription,
  compact = false,
}: {
  status?: QuoteStatus;
  customerId?: string;
  emptyTitle: string;
  emptyDescription: string;
  compact?: boolean;
}) {
  const list = useListController<QuoteQuery>({ limit: compact ? 10 : 20 });
  const { businessUnits } = useActiveScope();
  const create = useAction("quote.create");
  const [formOpen, setFormOpen] = useState(false);
  const [opened, setOpened] = useState<QuoteSummary | null>(null);

  /**
   * O nome do cliente filtrado, para o seletor mostrar sem uma consulta a mais.
   *
   * O `CustomerPicker` devolve o cliente inteiro ao escolher; guardar o rótulo
   * evita que reabrir a tela mostre o id, ou pareça vazio, quando a pessoa
   * escolhida está na página doze da listagem de clientes.
   */
  const [customerLabel, setCustomerLabel] = useState<string>();

  /** A situação fixa de quem embute vence o filtro; sem ela, a escolha é de quem olha. */
  const effectiveStatus = status ?? list.query.status;

  const query = useQuotes({
    ...list.query,
    status: effectiveStatus,
    customerId: customerId ?? list.query.customerId,
  });

  const quotes = query.data?.data ?? [];
  const meta = query.data?.meta;

  const prefix = `quotes-${status ?? "all"}`;

  const vazio = quotesEmptyCopy({
    isFiltered: list.isFiltered,
    status: effectiveStatus,
    emptyTitle,
    emptyDescription,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultSummary
          meta={meta}
          noun="orçamento"
          note="Ordenado do mais recente"
        />
        {create.allowed ? (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" />
            {create.label}
          </Button>
        ) : null}
      </div>

      <FilterBar
        onClear={() => {
          list.reset();
          setCustomerLabel(undefined);
        }}
        canClear={list.isFiltered}
      >
        <SearchField
          id={`${prefix}-search`}
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Título, código ou observações"
          hint="A busca cobre título, código e observações."
        />

        {/* Sem situação fixa, a situação é escolha de quem olha. */}
        {status ? null : (
          <FilterSelect
            id={`${prefix}-status`}
            label="Situação"
            value={list.query.status}
            onChange={(value) =>
              list.setFilter("status", value as QuoteStatus | undefined)
            }
            options={STATUS_OPTIONS}
            anyLabel="Todas"
          />
        )}

        {/* Dentro do cliente a pergunta já está respondida pela rota. */}
        {customerId ? null : (
          <div className="space-y-2">
            <Label htmlFor={`${prefix}-customer`}>Cliente</Label>
            <CustomerPicker
              id={`${prefix}-customer`}
              value={list.query.customerId}
              selectedLabel={customerLabel}
              anyLabel="Todos os clientes"
              placeholder="Todos os clientes"
              onChange={(customer) => {
                list.setFilter("customerId", customer?.id);
                setCustomerLabel(
                  customer
                    ? (customer.tradeName ?? customer.legalName)
                    : undefined,
                );
              }}
            />
          </div>
        )}

        {businessUnits.length > 1 ? (
          <FilterSelect
            id={`${prefix}-unit`}
            label="Organização"
            value={list.query.businessUnitId}
            onChange={(value) => list.setFilter("businessUnitId", value)}
            options={businessUnits.map((unit) => ({
              value: unit.id,
              label: unit.tradeName ?? unit.legalName,
            }))}
            anyLabel="Todas"
          />
        ) : null}

        <div className="space-y-2">
          <Label htmlFor={`${prefix}-from`}>Criados de</Label>
          <Input
            id={`${prefix}-from`}
            type="date"
            value={list.query.from ?? ""}
            onChange={(event) =>
              list.setFilter("from", event.target.value || undefined)
            }
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-to`}>até</Label>
          <Input
            id={`${prefix}-to`}
            type="date"
            value={list.query.to ?? ""}
            onChange={(event) =>
              list.setFilter("to", event.target.value || undefined)
            }
          />
        </div>

        {/*
          Validade: existe no contrato como `validUntilBefore`, e é o filtro que
          responde "o que vence primeiro" — a pergunta de quem cobra decisão.
        */}
        <div className="space-y-2">
          <Label htmlFor={`${prefix}-valid`}>Vence até</Label>
          <Input
            id={`${prefix}-valid`}
            type="date"
            value={list.query.validUntilBefore ?? ""}
            onChange={(event) =>
              list.setFilter(
                "validUntilBefore",
                event.target.value || undefined,
              )
            }
          />
        </div>
      </FilterBar>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={quotes}
        empty={{
          icon: <ReceiptText className="size-5" />,
          /** Vazio por recorte não é vazio por falta — ver `quotes-empty-state`. */
          title: vazio.title,
          description: vazio.description,
          action:
            create.allowed && vazio.offersCreate ? (
              <Button size="sm" onClick={() => setFormOpen(true)}>
                <Plus className="size-4" />
                {create.label}
              </Button>
            ) : undefined,
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Número</TableHead>
                  {customerId ? null : <TableHead>Cliente</TableHead>}
                  <TableHead>Equipamentos</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Valor total</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((quote) => (
                  <TableRow
                    key={quote.id}
                    onClick={() => setOpened(quote)}
                    className="cursor-pointer"
                  >
                    <TableCell>
                      {/* Link, e não só a linha clicável: o código é endereço de
                          uma página, e quem quer abrir em outra aba precisa de
                          um `<a>` de verdade. */}
                      <EntityLink
                        entity="quote"
                        id={quote.id}
                        className="font-medium"
                      >
                        {quote.code}
                      </EntityLink>
                      <span className="block truncate text-xs text-muted-foreground">
                        {quote.title}
                      </span>
                    </TableCell>
                    {customerId ? null : (
                      <TableCell className="text-muted-foreground">
                        {quote.customer.displayName}
                      </TableCell>
                    )}
                    <TableCell>
                      <Equipment assets={quote.assets} />
                    </TableCell>
                    <TableCell>
                      <EntityBadge
                        entity="quote"
                        group="status"
                        value={quote.status}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money
                        value={quote.total}
                        muted={quote.status === "CANCELLED"}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <ValidUntil quote={quote} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {quote.responsible?.displayName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <QuoteRowActions quote={quote} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={query.isFetching}
      />

      <QuoteWizardDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        customerId={customerId}
        onCreated={customerId ? () => list.setPage(1) : undefined}
      />

      <QuoteDetailSheet
        quote={opened}
        onOpenChange={(open) => !open && setOpened(null)}
      />
    </div>
  );
}

/**
 * Os equipamentos, na largura de uma célula.
 *
 * Dois nomes e a contagem do resto. A lista inteira empurraria as outras colunas
 * para fora da tela numa proposta com oito aparelhos — e quem precisa de todos
 * abre o resumo, que os mostra com identificação e local.
 */
function Equipment({
  assets,
}: {
  assets: readonly { id: string; name: string; identifier: string | null }[];
}) {
  if (assets.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const shown = assets.slice(0, 2);
  const rest = assets.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((asset) => (
        <Badge
          key={asset.id}
          variant="outline"
          className={cn("max-w-[10rem] truncate font-normal")}
          title={
            asset.identifier
              ? `${asset.name} · ${asset.identifier}`
              : asset.name
          }
        >
          {asset.identifier ?? asset.name}
        </Badge>
      ))}
      {rest > 0 ? (
        <span className="text-xs text-muted-foreground">+{rest}</span>
      ) : null}
    </div>
  );
}
