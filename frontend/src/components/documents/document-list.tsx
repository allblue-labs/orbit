"use client";

/**
 * Linhas da central.
 *
 * ## Duas origens, duas formas de linha
 *
 * A central lista o que a organização emitiu, e isso vem de dois motores. Uma
 * **execução** tem código, título, cliente e atendimento. Um **relatório
 * gerencial** retrata a operação inteira num intervalo: não tem código nem
 * cliente, e se identifica pelo tipo e pelo período. Cada linha mostra o que ela
 * tem — inventar um código para quem não tem seria pior que a coluna vazia.
 *
 * Quem decide o que cada linha diz e para onde ela leva é `issued-document-row`,
 * e não este arquivo: a concordância do texto e o destino do link precisam ser
 * prováveis, e dentro do `map` da tabela não são.
 *
 * ## Os vínculos continuam vindo do Entity Registry
 *
 * Operação e cliente viram link por ele: nenhuma rota é montada à mão, e uma
 * entidade sem tela registrada simplesmente não vira link.
 *
 * A listagem publica identificadores, não nomes. Resolver cada um viraria N+1 por
 * página; os nomes aparecem na tela do item, onde é uma leitura por vínculo.
 */
import { ArrowRight, FileStack } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/states";
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
import { RenderStatusBadge } from "@/documents";
import { EntityLink } from "@/entities/entity-components";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  ISSUED_DOCUMENT_SOURCE_LABELS,
  type IssuedDocument,
} from "@/types/issued-documents";
import {
  hasRevisionHistory,
  issuedDocumentHref,
  issuedDocumentIdentity,
  issuedDocumentTypeLabel,
  type ReportTypeLabels,
} from "./issued-document-row";

export function DocumentList({
  documents,
  reportTypes,
  onOpen,
}: {
  documents: readonly IssuedDocument[];
  /** Rótulos de tipo de relatório, como o catálogo do servidor os publica. */
  reportTypes: ReportTypeLabels;
  onOpen: (executionId: string) => void;
}) {
  if (documents.length === 0) {
    return (
      <EmptyState
        icon={<FileStack className="size-5" />}
        title="Nada nesta fila"
        description="Nenhum documento desta página está nesta situação."
      />
    );
  }

  return (
    <div className="glass-panel overflow-x-auto rounded-xl">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Documento</TableHead>
            {/*
              O tipo aparece.

              Dava para **filtrar** por tipo e não dava para vê-lo: quem escolhia
              "PMOC" no filtro não tinha como conferir na lista que era isso que
              estava vendo — um filtro cujo efeito não se verifica.
            */}
            <TableHead>Tipo</TableHead>
            <TableHead>Origem</TableHead>
            <TableHead>Arquivo</TableHead>
            <TableHead>Vínculos</TableHead>
            <TableHead>Emitido</TableHead>
            <TableHead className="w-20" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((document) => {
            const identidade = issuedDocumentIdentity(document, reportTypes);
            return (
              <TableRow key={`${document.source}-${document.id}`}>
                <TableCell>
                  <Link
                    href={issuedDocumentHref(document)}
                    className="block min-w-0 space-y-0.5 hover:underline"
                  >
                    <span className="block truncate font-medium">
                      {identidade.primary}
                    </span>
                    {identidade.secondary ? (
                      <span
                        className={cn(
                          "text-xs text-muted-foreground",
                          identidade.secondaryIsCode && "font-mono",
                        )}
                      >
                        {identidade.secondary}
                      </span>
                    ) : null}
                  </Link>
                </TableCell>

                <TableCell className="text-sm">
                  {issuedDocumentTypeLabel(document, reportTypes)}
                </TableCell>

                <TableCell>
                  <Badge variant="outline" className="text-xs font-normal">
                    {ISSUED_DOCUMENT_SOURCE_LABELS[document.source]}
                  </Badge>
                </TableCell>

                <TableCell>
                  <div className="flex items-center gap-2">
                    <RenderStatusBadge status={document.renderStatus} />
                    {/*
                      Quantas vezes saiu, quando saiu mais de uma.

                      Reemitir não substitui em silêncio — a revisão anterior fica
                      no histórico —, e quem procura "o documento que mandei" precisa
                      saber que existe mais de uma versão dele.
                    */}
                    {document.revisions > 1 ? (
                      <span className="text-xs text-muted-foreground">
                        {document.revisions} revisões
                      </span>
                    ) : null}
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex flex-wrap gap-1.5 text-xs">
                    {document.operationId ? (
                      <EntityLink entity="operation" id={document.operationId}>
                        Operação
                      </EntityLink>
                    ) : null}
                    {document.customerId ? (
                      <EntityLink entity="customer" id={document.customerId}>
                        Cliente
                      </EntityLink>
                    ) : null}
                  </div>
                </TableCell>

                {/*
                  A data da emissão, e não a da última alteração.
                  "Atualizado" respondia quando a execução mexeu por último, que
                  numa aba chamada Documentos emitidos é a pergunta errada.
                */}
                <TableCell className="text-sm text-muted-foreground">
                  {document.issuedAt ? formatDateTime(document.issuedAt) : "—"}
                </TableCell>

                <TableCell>
                  {/*
                    O visualizador folheia manifestos, e relatório gerencial não
                    tem manifesto — tem um arquivo, que a página dele entrega.
                    Oferecer "abrir" aqui abriria um visualizador vazio.
                  */}
                  {hasRevisionHistory(document) ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpen(document.id)}
                    >
                      Abrir
                      <ArrowRight className="size-4" />
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
