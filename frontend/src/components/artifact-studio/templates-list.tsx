"use client";

/**
 * Os modelos de documento disponíveis para a operação.
 *
 * ## O que esta tela deixou de ser
 *
 * Era uma tabela de templates com seis colunas técnicas — chave, status,
 * visibilidade, versão — e dois caminhos: **criar um modelo do zero** e abrir o
 * editor de estrutura. Isso invertia a relação: quem administra uma empresa de
 * refrigeração não desenha um formulário de PMOC campo por campo; usa o modelo
 * que já atende a norma. Construir um modelo à mão produzia, na prática, um
 * documento pior que o oficial, com o mesmo trabalho de um dia.
 *
 * Os sete modelos do Orbit — Ordem de Serviço, PMOC, RVT, Laudo Técnico,
 * Qualidade do Ar, Recibo e Orçamento — são semeados na subida do sistema e já
 * saem com o acabamento premium. A tela passou a ser o que a pergunta pede:
 * **quais modelos eu tenho, e como cada um sai impresso**.
 *
 * ## De onde vem a lista
 *
 * `GET /artifact-templates` devolve os templates da organização **e** os globais
 * ativos da plataforma, na mesma página — é o comportamento do repositório. A
 * apresentação de cada tipo (nome, descrição, ícone, ordem) vem do Template Type
 * Registry; a lista de quais existem, sempre do servidor.
 *
 * ## O construtor manual não foi apagado
 *
 * `ArtifactStudio` e os seus diálogos continuam no repositório, sem porta de
 * entrada. O editor é a única forma de inspecionar a estrutura de um template, e
 * vai voltar quando houver caso de uso real para personalizar — reescrever 3.400
 * linhas de editor para trazê-lo de volta seria o desperdício.
 */
import { LayoutTemplate } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useArtifactTemplatesList } from "@/hooks/artifact-templates/use-artifact-templates";
import type {
  ArtifactTemplateListItem,
  ArtifactTemplateQuery,
} from "@/types/artifact-templates";
import {
  getTemplateType,
  resolveTemplateType,
  TemplateTypeGlyph,
} from "@/artifacts";
import { isPlatformTemplate, PlatformTemplateBadge } from "./template-badges";
import { ModelSampleDialog } from "./model-sample-dialog";
import { ListState, Pagination, useListController } from "@/workspace";

/**
 * Só o que está publicado.
 *
 * Um template em rascunho não emite documento — oferecê-lo aqui seria oferecer
 * um modelo que a operação não consegue usar. O recorte é do servidor.
 */
const SOMENTE_ATIVOS: Partial<ArtifactTemplateQuery> = { status: "ACTIVE" };

export function TemplatesList() {
  const list = useListController<ArtifactTemplateQuery>({
    limit: 24,
    initial: SOMENTE_ATIVOS,
  });

  const query = useArtifactTemplatesList(list.query);
  const templates = query.data?.data ?? [];
  const meta = query.data?.meta;

  return (
    <div className="space-y-6">
      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={templates}
        rows={4}
        empty={{
          icon: <LayoutTemplate className="size-5" />,
          title: "Nenhum modelo disponível",
          description:
            "Os modelos do Orbit são instalados junto com o sistema. Se a lista está vazia, o catálogo ainda não foi aplicado nesta instalação.",
        }}
      >
        {(rows) => (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((template) => (
              <ModelCard key={template.id} template={template} />
            ))}
          </ul>
        )}
      </ListState>

      <Pagination
        meta={meta}
        onPrevious={list.previousPage}
        onNext={list.nextPage}
        isFetching={query.isFetching}
      />
    </div>
  );
}

function ModelCard({ template }: { template: ArtifactTemplateListItem }) {
  const type = resolveTemplateType(template.artifactType);

  return (
    <li className="glass-panel flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5">
          <TemplateTypeGlyph artifactType={template.artifactType} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="flex flex-wrap items-center gap-2 font-medium">
            {template.name}
            {isPlatformTemplate(template) ? <PlatformTemplateBadge /> : null}
          </h3>
          {/*
           * A descrição do registry, não a do banco: a do template é opcional e
           * costuma vir vazia nos globais, e um cartão sem texto não ajuda
           * ninguém a escolher. A do banco vence quando existe, porque aí é a
           * organização falando do próprio modelo.
           */}
          <p className="mt-1 text-sm text-muted-foreground">
            {template.description ?? type.description}
          </p>
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <Badge variant="outline">{type.name}</Badge>
        {/*
         * O exemplo existe para os tipos que o catálogo conhece.
         *
         * `getTemplateType` devolve `undefined` para um tipo que a organização
         * inventou, e para esse o servidor não tem amostra: oferecer o botão
         * renderia um erro no lugar do documento.
         */}
        {getTemplateType(template.artifactType) ? (
          <ModelSampleDialog
            artifactType={template.artifactType}
            modelName={template.name}
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            Sem exemplo para este tipo
          </span>
        )}
      </div>
    </li>
  );
}
