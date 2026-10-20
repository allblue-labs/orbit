"use client";

/**
 * Customer Workspace V2 — o cliente como entrada da operação.
 *
 * ## A consolidação
 *
 * O parque instalado deixou de ser um módulo paralelo. Quem contratou o
 * serviço é o cliente; os **equipamentos** são dele, e é a partir dele que se
 * chega a eles. "Equipamentos" saiu do menu principal e virou uma aba daqui —
 * a rota individual continua existindo, para deep link e QR Code.
 *
 * ## Seis fontes independentes
 *
 * ```
 * GET /customers/:id                   geral · endereço · contatos · contagens
 * GET /assets?customerId=              equipamentos
 * GET /operations?customerId=          operações
 * GET /scheduling/events?customerId=   agenda futura
 * GET /artifact-executions?customerId= execuções e documentos
 * GET /ai-executions?customerId=       Orbit Intelligence
 * ```
 *
 * `customerId` é filtro real nos cinco contratos cruzados — nada é recortado
 * no cliente, e todos os serviços já existiam.
 *
 * ## Abas e isolamento
 *
 * Cada aba tem consulta própria e **Error Boundary próprio**. As fontes são de
 * módulos diferentes, com capabilities diferentes: sem `assets.read` a aba de
 * equipamentos declara a ausência de acesso e as outras seguem funcionando.
 *
 * A aba só monta quando aberta — trocar de aba não recarrega as anteriores,
 * porque a Query Layer mantém o cache, e abrir a tela não dispara as seis
 * consultas de uma vez.
 *
 * O cabeçalho e a navegação resolvem tudo pelo **Entity Registry** — não há
 * `switch` de entidade nesta árvore.
 */
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, RefreshCw } from "lucide-react";

import { useAction } from "@/actions";

import { ContentContainer } from "@/components/layout/page-primitives";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEntityAccess } from "@/entities";
import { useCustomer } from "@/hooks/customers/use-customers";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import { PRODUCT_CAPABILITY, PRODUCT_FEATURE } from "@/registry/product-access";
import type { Customer } from "@/types/customers";
import { TabBoundary } from "@/workspace";
import { CustomerFormDialog } from "../customer-form.dialog";
import {
  CustomerStatusBadge,
  customerTypeLabel,
} from "../customer-presentation";
import {
  ContactsSection,
  CustomerScheduleSection,
  IndicatorsSection,
  IntelligenceSection,
  OverviewSection,
} from "./panels";
import { CustomerQuotesTab } from "./tabs/quotes.tab";
import { AddressesTab } from "./tabs/addresses.tab";
import { EquipmentTab } from "./tabs/equipment.tab";
import { HistoryTab } from "./tabs/history.tab";
import {
  DocumentsTab,
  ExecutionsTab,
  OperationsTab,
} from "./tabs/records.tabs";

export function CustomerWorkspace({ customerId }: { customerId: string }) {
  const query = useCustomer(customerId);

  if (query.isPending) {
    return (
      <ContentContainer size="wide" className="space-y-6">
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
          <PanelLoading rows={10} />
          <PanelLoading rows={6} />
        </div>
      </ContentContainer>
    );
  }

  if (query.error || !query.data) {
    return (
      <ContentContainer size="wide" className="space-y-6">
        <Button variant="ghost" size="sm" asChild>
          <Link href={ROUTES.customers}>
            <ArrowLeft className="size-4" />
            Voltar
          </Link>
        </Button>
        <PanelError error={query.error} onRetry={() => void query.refetch()} />
      </ContentContainer>
    );
  }

  return (
    <WorkspaceBody
      customer={query.data}
      onRefresh={() => void query.refetch()}
    />
  );
}

function WorkspaceBody({
  customer,
  onRefresh,
}: {
  customer: Customer;
  onRefresh: () => void;
}) {
  const session = useSession();
  const { definition } = useEntityAccess("customer");
  const canReadIntelligence =
    session.hasPermission("ai.executions.read") &&
    session.hasCapability("ai.executions.read") &&
    session.canUseProductFeature(
      PRODUCT_CAPABILITY.ORBIT_INTELLIGENCE,
      PRODUCT_FEATURE.ORBIT_INTELLIGENCE,
    );

  /**
   * Uma autoridade só para editar.
   *
   * `can("update")` e `useAction("customer.update")` resolvem a mesma entrada
   * do registry pela mesma função — ter as duas na tela seria manter dois
   * caminhos que só por acidente concordam. Fica a que também traz o rótulo.
   */
  const edit = useAction("customer.update");
  const canManage = edit.allowed;
  const [editOpen, setEditOpen] = useState(false);

  return (
    <ContentContainer size="wide" className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <Button variant="ghost" size="sm" asChild className="-ml-2">
            <Link href={ROUTES.customers}>
              <ArrowLeft className="size-4" />
              {definition.labelPlural}
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <definition.icon
              className={`size-6 shrink-0 ${definition.color}`}
              aria-hidden
            />
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {customer.tradeName ?? customer.legalName}
            </h1>
            <CustomerStatusBadge status={customer.status} />
            <Badge variant="secondary">
              {customerTypeLabel(customer.type)}
            </Badge>
          </div>
          {customer.tradeName ? (
            <p className="text-xs text-muted-foreground">
              {customer.legalName}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Atualizado em {formatDateTime(customer.updatedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {edit.allowed ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="size-4" />
              {edit.label}
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            <RefreshCw className="size-4" />
            Atualizar
          </Button>
        </div>
      </header>

      {/* A escrita semeia o cache com a resposta do servidor; a ficha se redesenha sozinha. */}
      <CustomerFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        editing={customer}
      />

      <Tabs defaultValue="geral">
        <TabsList>
          <TabsTrigger value="geral">Visão geral</TabsTrigger>
          <TabsTrigger value="equipamentos">
            Equipamentos
            <Badge variant="secondary" className="ml-1.5">
              {customer.counts.assets}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="enderecos">Endereços</TabsTrigger>
          <TabsTrigger value="operacoes">
            Operações
            <Badge variant="secondary" className="ml-1.5">
              {customer.counts.operations}
            </Badge>
          </TabsTrigger>
          {/*
            Orçamentos do cliente.
            Sem crachá de contagem: `GET /customers/:id` publica `counts` de
            equipamentos e operações, não de propostas — e inventar o número
            somando uma página daria o tamanho da página.
          */}
          <TabsTrigger value="orcamentos">Orçamentos</TabsTrigger>
          <TabsTrigger value="execucoes">Execuções</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        {/*
          Uma fronteira de erro por aba.

          As abas leem módulos diferentes; uma falha de renderização em
          Documentos não deve derrubar Visão geral. As contagens dos crachás
          vêm do próprio `GET /customers/:id` (`counts`), calculadas no banco —
          nada é somado aqui.
        */}
        <TabsContent value="geral">
          <TabBoundary id="customer-overview" label="a visão geral">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
              <div className="min-w-0 space-y-6">
                <OverviewSection customer={customer} />
                <ContactsSection customer={customer} canManage={canManage} />
                <CustomerScheduleSection customerId={customer.id} />
              </div>
              <div className="min-w-0 space-y-6">
                <IndicatorsSection customer={customer} />
                {canReadIntelligence ? (
                  <IntelligenceSection customerId={customer.id} enabled />
                ) : null}
              </div>
            </div>
          </TabBoundary>
        </TabsContent>

        <TabsContent value="equipamentos">
          <TabBoundary id="customer-equipment" label="os equipamentos">
            <EquipmentTab customerId={customer.id} />
          </TabBoundary>
        </TabsContent>

        {/*
          Onde o técnico é atendido, e não onde a nota é emitida.

          A aba existe porque o endereço deixou de ser um campo do cadastro: um
          cliente pode ter várias lojas, e o atendimento precisa dizer em qual.
        */}
        <TabsContent value="enderecos">
          <TabBoundary id="customer-addresses" label="os endereços">
            <AddressesTab customerId={customer.id} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="operacoes">
          <TabBoundary id="customer-operations" label="as operações">
            <OperationsTab customerId={customer.id} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="orcamentos">
          <TabBoundary id="customer-quotes" label="os orçamentos">
            <CustomerQuotesTab customerId={customer.id} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="execucoes">
          <TabBoundary id="customer-executions" label="as execuções">
            <ExecutionsTab customerId={customer.id} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="documentos">
          <TabBoundary id="customer-documents" label="os documentos">
            <DocumentsTab customerId={customer.id} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="historico">
          <TabBoundary id="customer-history" label="o histórico">
            <HistoryTab />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </ContentContainer>
  );
}
