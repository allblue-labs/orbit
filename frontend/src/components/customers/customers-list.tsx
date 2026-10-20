"use client";

/**
 * Listagem de clientes.
 *
 * **Filtros.** `CustomerQueryDto` aceita `search`, `type`, `status`, `page` e
 * `limit`. Nada além disso — verificado: `?city=Recife` devolve
 * `['property city should not exist']`.
 *
 * Por isso a tela **não** oferece filtro por unidade, cidade nem responsável:
 *
 * - **unidade** — o cliente é da organização; não há `businessUnitId` no
 *   modelo `Customer` (só o contato tem);
 * - **cidade** — mora em `address`, que é `Json?` sem esquema e sem índice;
 * - **responsável** — não existe campo de gestor de conta.
 *
 * A busca cobre nome, nome fantasia, documento e e-mail, então
 * localizar por cidade só funciona se ela estiver no texto buscado — e a tela
 * não promete o contrário.
 *
 * **Ordenação** é do backend (`legalName asc, id asc`), declarada no cabeçalho.
 *
 * Busca, filtros, contagem, paginação e estados vêm do Workspace Core.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Handshake, Plus } from "lucide-react";

import { useAction } from "@/actions";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { entityHref } from "@/entities";
import { useCustomersList } from "@/hooks/customers/use-customers";
import { CustomerStatus, CustomerType } from "@/types/contracts";
import {
  CUSTOMER_LIMITS,
  type Customer,
  type CustomerQuery,
} from "@/types/customers";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";
import { CustomerFormDialog } from "./customer-form.dialog";
import {
  customerStatusLabel,
  customerTypeLabel,
  CustomerStatusBadge,
  readAddress,
} from "./customer-presentation";

const TYPE_OPTIONS = Object.values(CustomerType).map((type) => ({
  value: type,
  label: customerTypeLabel(type),
}));

const STATUS_OPTIONS = Object.values(CustomerStatus).map((status) => ({
  value: status,
  label: customerStatusLabel(status),
}));

export function CustomersList() {
  const router = useRouter();
  const list = useListController<CustomerQuery>({ limit: 20 });
  const query = useCustomersList(list.query);
  const customers = query.data?.data ?? [];
  const meta = query.data?.meta;

  /**
   * Quem pode cadastrar é o Action Registry que diz — os mesmos `customers.create`
   * e `crm.manage` que o controlador exige. A tela não recalcula autorização.
   */
  const create = useAction("customer.create");
  const [formOpen, setFormOpen] = useState(false);

  return (
    <div className="space-y-6">
      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <SearchField
          id="customers-search"
          value={list.searchTerm}
          onChange={list.setSearchTerm}
          placeholder="Nome, documento ou e-mail"
          maxLength={CUSTOMER_LIMITS.searchMaxLength}
        />
        <FilterSelect
          id="customers-type"
          label="Tipo"
          value={list.query.type}
          onChange={(value) =>
            list.setFilter("type", value as CustomerQuery["type"])
          }
          options={TYPE_OPTIONS}
        />
        <FilterSelect
          id="customers-status"
          label="Status"
          value={list.query.status}
          onChange={(value) =>
            list.setFilter("status", value as CustomerQuery["status"])
          }
          options={STATUS_OPTIONS}
        />
      </FilterBar>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ResultSummary
          meta={meta}
          noun="cliente"
          note="Ordenado por razão social"
        />
        {create.allowed ? (
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="size-4" />
            {create.label}
          </Button>
        ) : null}
      </div>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={customers}
        empty={{
          icon: <Handshake className="size-5" />,
          title: "Nenhum cliente encontrado",
          description: "Ajuste a busca ou os filtros para ver mais resultados.",
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cidade</TableHead>
                  <TableHead>Contato principal</TableHead>
                  <TableHead>Vínculos</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((customer) => (
                  <CustomerRow key={customer.id} customer={customer} />
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

      {/*
       * Criado o cliente, a ficha dele é o lugar onde o trabalho continua —
       * contatos, equipamentos, operações. A listagem já foi invalidada pela
       * escrita, então voltar para cá mostra o registro novo.
       */}
      <CustomerFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={(customer) => {
          const href = entityHref("customer", customer.id);
          if (href) router.push(href);
        }}
      />
    </div>
  );
}

function CustomerRow({ customer }: { customer: Customer }) {
  const href = entityHref("customer", customer.id) ?? "#";
  const address = readAddress(customer.address);
  const primary =
    customer.contacts.find((item) => item.isPrimary) ?? customer.contacts[0];

  return (
    <TableRow>
      <TableCell>
        <div className="min-w-0 space-y-1">
          <Link href={href} className="font-medium hover:underline">
            {customer.tradeName ?? customer.legalName}
          </Link>
          {customer.documentNumber ? (
            <p className="font-mono text-xs text-muted-foreground">
              {customer.documentType} {customer.documentNumber}
            </p>
          ) : null}
        </div>
      </TableCell>
      <TableCell className="text-sm">
        {customerTypeLabel(customer.type)}
      </TableCell>
      <TableCell>
        <CustomerStatusBadge status={customer.status} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {address.city ?? "—"}
        {address.stateCode ? `/${address.stateCode}` : ""}
      </TableCell>
      <TableCell className="text-sm">
        {primary ? (
          <>
            {primary.name}
            {primary.role ? (
              <span className="block text-xs text-muted-foreground">
                {primary.role}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px]">
            {customer.counts.assets} equipamento(s)
          </Badge>
          <Badge variant="secondary" className="text-[10px]">
            {customer.counts.operations} operação(ões)
          </Badge>
        </div>
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon" asChild>
          <Link href={href} aria-label={`Abrir ${customer.legalName}`}>
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </TableCell>
    </TableRow>
  );
}
