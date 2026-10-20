"use client";

/**
 * Document Center — a central documental.
 *
 * ## De onde vem a lista
 *
 * **Não existe listagem global de manifests.** O backend publica revisões
 * sempre sob uma execução — decisão explícita da PR-19 de não criar endpoint
 * administrativo. As revisões de uma execução são carregadas quando ela é aberta.
 *
 * A lista vem de `GET /issued-documents`, que une **duas origens** no banco: as
 * execuções do Artifact Engine e os relatórios gerenciais. Os dois emitem
 * documento com arquivo guardado, e só o primeiro aparecia aqui — um relatório
 * recém-gerado não estava em nenhuma lista chamada "Documentos emitidos".
 *
 * A união é do servidor, e não daqui, pelo mesmo motivo que as filas deixaram de
 * ser recorte de página: somar duas listas paginadas no navegador faz `total`
 * mentir e deixa a página 2 de uma sem continuidade com a página 1 da outra.
 *
 * ## As filas passaram a ser consulta, não recorte da página
 *
 * Antes, `renderStatus` não era filtro do contrato: a tela carregava uma página
 * de execuções e as separava em memória. As contagens eram da página, não da
 * organização — a aba "Emitidos" dizia 3 enquanto havia 200 —, e a paginação
 * ficava sem sentido: a página 2 podia estar inteira numa fila que não era a
 * aberta.
 *
 * Agora `renderStatus`, `artifactType`, a origem e o período são filtros do
 * servidor (`IssuedDocumentQueryDto`), a fila aberta é a consulta, e o total é o
 * total. A contagem das filas fechadas deixou de existir em vez de existir
 * errada: uma contagem por fila exigiria cinco consultas por navegação, e o
 * caminho honesto é o backend publicar o agrupamento — não a tela fingir.
 *
 * ## O que ainda não se pode filtrar
 *
 * Formato e renderizador não estão no contrato de execuções, e a busca é a que
 * o servidor suporta: código e título. Buscar pelo conteúdo do documento
 * exigiria indexar o texto emitido, que não existe.
 */
import { useMemo, useState } from "react";
import { FileStack } from "lucide-react";

import { ContentContainer } from "@/components/layout/page-primitives";
import { ReferencePicker } from "@/components/scheduling/reference-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resolveRenderStatus } from "@/documents";
import { allTemplateTypes } from "@/artifacts";
import { useIssuedDocuments } from "@/hooks/issued-documents/use-issued-documents";
import { useReportCatalog } from "@/hooks/management-reports/use-management-reports";
import { useActiveScope } from "@/providers/use-active-scope";
import { schedulingReferencesService } from "@/services/scheduling-references.service";
import {
  ISSUED_DOCUMENT_SOURCE_LABELS,
  type IssuedDocumentQuery,
  type IssuedDocumentSource,
} from "@/types/issued-documents";
import type { RenderStatus } from "@/types/documents";
import {
  FilterBar,
  FilterSelect,
  ListState,
  Pagination,
  ResultSummary,
  SearchField,
  useListController,
} from "@/workspace";
import { DocumentList } from "./document-list";
import { DocumentViewer } from "./document-viewer";

/**
 * Filas da central, na ordem em que interessam.
 *
 * `READY` primeiro: a pergunta mais comum é "cadê o documento". As filas de
 * produção e falha vêm em seguida, e as execuções sem documento por último —
 * são a maioria e a menos urgente.
 */
const QUEUES: readonly RenderStatus[] = [
  "READY",
  "RENDERING",
  "PENDING",
  "FAILED",
  "NOT_RENDERED",
];

/** As filas na ordem acima, com a apresentação do Document Registry. */
const QUEUE_TABS = QUEUES.map((id) => resolveRenderStatus(id));

const TYPE_OPTIONS = allTemplateTypes().map((type) => ({
  value: type.id,
  label: type.name,
}));

/**
 * As duas origens como filtro.
 *
 * Não é navegação disfarçada: a lista continua trazendo as duas por omissão, e
 * isto só recorta. Quem administra documento de atendimento e quem acompanha
 * relatório de período costumam ser a mesma pessoa em momentos diferentes.
 */
const SOURCE_OPTIONS = (
  Object.keys(ISSUED_DOCUMENT_SOURCE_LABELS) as IssuedDocumentSource[]
).map((source) => ({
  value: source,
  label: ISSUED_DOCUMENT_SOURCE_LABELS[source],
}));

/**
 * `embedded` quando a central vive **dentro** de outra aba.
 *
 * Os documentos emitidos passaram a ser aba de Relatórios, e lá o contêiner e o
 * espaçamento são da página de fora: repetir o `ContentContainer` aplicaria a
 * largura máxima duas vezes, e o conteúdo apareceria mais estreito que as abas
 * irmãs.
 */
export function DocumentCenter({ embedded = false }: { embedded?: boolean }) {
  const { businessUnitId, businessUnits } = useActiveScope();
  const [queue, setQueue] = useState<RenderStatus>("READY");
  const [selected, setSelected] = useState<string | null>(null);
  /** O rótulo do cliente escolhido, para o seletor não mostrar um id. */
  const [customerLabel, setCustomerLabel] = useState<string>();
  const list = useListController<IssuedDocumentQuery>({ limit: 20 });

  /**
   * O catálogo de tipos de relatório, para a coluna Tipo dizer o nome.
   *
   * Os dois vocabulários de tipo são diferentes e nenhum traduz o outro: o de
   * artefato vem do registro local, o de relatório é publicado pelo servidor.
   * É consulta de catálogo, cacheada, e não uma por linha.
   */
  const catalog = useReportCatalog();
  const reportTypes = useMemo(
    () =>
      Object.fromEntries(
        (catalog.data?.types ?? []).map((type) => [type.type, type.name]),
      ),
    [catalog.data],
  );

  const query = useMemo<IssuedDocumentQuery>(
    () => ({
      ...list.query,
      /* A unidade ativa do escopo vence o filtro: é a mesma regra das outras
         listas, e o seletor de unidade só aparece quando o acesso é de
         organização. */
      businessUnitId: businessUnitId ?? list.query.businessUnitId,
      renderStatus: queue,
    }),
    [list.query, businessUnitId, queue],
  );

  const documents = useIssuedDocuments(query);
  const items = useMemo(() => documents.data?.data ?? [], [documents.data]);
  const meta = documents.data?.meta;

  const Wrapper = embedded ? EmbeddedWrapper : ContainedWrapper;

  return (
    <Wrapper>
      {/* O `data-testid` é do e2e de alinhamento: a faixa de filtros e a
          lista precisam terminar na mesma coluna. */}
      <div data-testid="documents-filters">
        <FilterBar onClear={list.reset} canClear={list.isFiltered}>
          <SearchField
            id="documents-search"
            value={list.searchTerm}
            onChange={list.setSearchTerm}
            placeholder="Código ou título da execução"
            hint="A busca considera o código e o título do atendimento, não o conteúdo do documento."
          />

          <ReferencePicker
            id="documents-customer"
            label="Cliente"
            placeholder="Todos"
            value={list.query.customerId}
            selectedLabel={customerLabel}
            queryKey={schedulingReferencesService.keys.customers}
            fetcher={(search, options) =>
              schedulingReferencesService.customers(search, options)
            }
            toOption={(customer) => ({
              id: customer.id,
              label: customer.tradeName ?? customer.legalName,
            })}
            onChange={(customerId, label) => {
              list.setFilter("customerId", customerId);
              setCustomerLabel(label);
            }}
          />

          <FilterSelect
            id="documents-type"
            label="Tipo"
            value={list.query.artifactType}
            onChange={(value) => list.setFilter("artifactType", value)}
            options={TYPE_OPTIONS}
            anyLabel="Todos"
          />

          {/*
            A situação do atendimento saiu.

            Ela era do vocabulário da execução — `UNDER_REVIEW`, `APPROVED` —, e
            relatório gerencial não tem nenhum desses estados. Um seletor com os
            dois vocabulários juntos ofereceria combinações que não existem, e
            escolher uma devolveria lista vazia sem explicar por quê. O que
            interessa sobre o arquivo são as filas, que as duas origens têm.
          */}
          <FilterSelect
            id="documents-source"
            label="Origem"
            value={list.query.source}
            onChange={(value) =>
              list.setFilter("source", value as IssuedDocumentSource)
            }
            options={SOURCE_OPTIONS}
            anyLabel="Todas"
          />

          {businessUnits.length > 1 && !businessUnitId ? (
            <FilterSelect
              id="documents-unit"
              label="Unidade"
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
            <Label htmlFor="documents-from">Criados de</Label>
            <Input
              id="documents-from"
              type="date"
              value={list.query.createdFrom ?? ""}
              onChange={(event) =>
                list.setFilter("createdFrom", event.target.value || undefined)
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="documents-to">até</Label>
            <Input
              id="documents-to"
              type="date"
              value={list.query.createdTo ?? ""}
              onChange={(event) =>
                list.setFilter("createdTo", event.target.value || undefined)
              }
            />
          </div>
        </FilterBar>
      </div>

      <Tabs
        value={queue}
        onValueChange={(value) => setQueue(value as RenderStatus)}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            {QUEUE_TABS.map((status) => (
              <TabsTrigger key={status.id} value={status.id}>
                {status.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <ResultSummary meta={meta} noun="documento" />
        </div>

        <div data-testid="documents-results">
          <ListState
            isPending={documents.isPending}
            error={documents.error}
            onRetry={() => void documents.refetch()}
            items={items}
            empty={{
              icon: <FileStack className="size-5" />,
              title: emptyTitleFor(queue),
              description:
                "Os documentos aparecem aqui depois que uma execução é submetida e renderizada.",
            }}
          >
            {/*
             * Um `TabsContent` só, o da fila aberta.
             *
             * Cinco continham a mesma lista — a consulta já é por fila — e o
             * Radix escondia quatro. Eram quatro árvores de React montadas
             * para não aparecer.
             */}
            {() => (
              <TabsContent value={queue}>
                <DocumentList
                  documents={items}
                  reportTypes={reportTypes}
                  onOpen={setSelected}
                />
              </TabsContent>
            )}
          </ListState>
        </div>
      </Tabs>

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={documents.isFetching}
      />

      <DocumentViewer
        executionId={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </Wrapper>
  );
}

/**
 * O vazio fala da fila aberta.
 *
 * "Nenhum documento nesta unidade" era a mesma frase nas cinco filas, e na de
 * falhas dizia o contrário do que se queria ler: nenhuma falha é boa notícia.
 */
function emptyTitleFor(queue: RenderStatus): string {
  const titles: Readonly<Record<RenderStatus, string>> = {
    READY: "Nenhum documento emitido por aqui",
    RENDERING: "Nada sendo produzido agora",
    PENDING: "Nenhuma emissão na fila",
    FAILED: "Nenhuma emissão falhou",
    NOT_RENDERED: "Nenhum atendimento sem documento",
  };
  return titles[queue];
}

/** Dentro de uma aba: só o espaçamento, sem segundo contêiner. */
function EmbeddedWrapper({ children }: { children: React.ReactNode }) {
  return <div className="space-y-6">{children}</div>;
}

/** Página própria: a central gerencia a própria largura. */
function ContainedWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ContentContainer size="wide" className="space-y-6">
      {children}
    </ContentContainer>
  );
}
