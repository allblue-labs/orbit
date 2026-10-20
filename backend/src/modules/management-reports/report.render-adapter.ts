/**
 * Do snapshot para o renderizador que já existe.
 *
 * ## Não há segundo gerador de PDF
 *
 * O Orbit tem um: `ArtifactRenderer`, com `pdf.default` e `html.default`. Este
 * adaptador traduz o snapshot de um relatório para o `RenderInput` que esses
 * motores já consomem — a mesma estrutura de seções e campos que um formulário
 * de campo produz. O relatório vira um documento com cabeçalho, seções e
 * rodapé, desenhado pelo mesmo código, com a mesma identidade visual.
 *
 * A tradução é a parte barata; escrever um segundo desenhador de PDF seria a
 * cara — e no dia em que o motor mudar, um dos dois ficaria para trás.
 *
 * ## Tabela vira campos
 *
 * `RenderFieldInput` é um par rótulo/valor, e é o que o motor sabe desenhar.
 * Uma tabela de doze linhas vira doze campos com o rótulo da primeira coluna;
 * uma grade de verdade exigiria estender o contrato de renderização, que é do
 * Artifact Engine e serve a outro dono. O documento sai legível e o formato
 * tabular fica declarado como limitação.
 *
 * ## O timbre é o da unidade
 *
 * O premium imprime cabeçalho com logo, e ele vem de `metadata.documentContext`
 * — o mesmo caminho que os documentos de campo usam. Sem isso o relatório sairia
 * com a moldura da marca e sem marca nenhuma: o pior dos dois mundos.
 *
 * ## Sem assinatura
 *
 * `signatures: []`, sempre. Um relatório gerencial não é assinado: ele não é
 * declaração de ninguém, é o retrato do que o sistema registrou. Slots de
 * assinatura vazios num PDF gerencial convidariam alguém a tratá-lo como
 * documento formal.
 */
import { Injectable } from '@nestjs/common';
import type {
  RenderFieldInput,
  RenderInput,
  RenderSectionInput,
} from '../artifact-rendering/renderers/artifact-renderer';
import type { DocumentEmitter } from '../artifact-rendering/renderers/pdf/kit/document-context';
import type {
  ReportSectionReadModel,
  ReportSnapshotReadModel,
} from './report.read-models';

@Injectable()
export class ReportRenderAdapter {
  toRenderInput(input: {
    reportId: string;
    snapshot: ReportSnapshotReadModel;
    organizationName: string;
    correlationId: string;
    sourceHash: string;
    /** Timbre da unidade do recorte; ausente quando não há unidade cadastrada. */
    emitter?: DocumentEmitter;
  }): RenderInput {
    const { snapshot } = input;

    return {
      execution: {
        id: input.reportId,
        /** O código do documento é o hash curto: identifica o retrato. */
        code: `${snapshot.type}-${input.sourceHash.slice(0, 8)}`,
        title: snapshot.name,
        status: 'READY',
        startedAt: snapshot.period.from,
        completedAt: snapshot.period.to,
      },
      /**
       * O contrato de renderização descreve o artefato que originou o
       * documento. Um relatório não vem de template: o "snapshot" declarado
       * aqui é o **do próprio relatório** — tipo, versão do formato e hash da
       * fonte —, que é o que o rodapé precisa para identificar o retrato.
       */
      snapshot: {
        id: input.reportId,
        templateKey: snapshot.type,
        templateName: snapshot.name,
        templateVersion: snapshot.schemaVersion,
        artifactType: 'MANAGEMENT_REPORT',
        structureHash: input.sourceHash,
      },
      sections: snapshot.sections.map((section, index) =>
        this.section(section, index),
      ),
      signatures: [],
      branding: {
        organizationName: input.organizationName,
        documentTitle: snapshot.name,
        headerText: this.period(snapshot),
        footerText: `Fonte: ${snapshot.sources
          .filter((source) => source.included)
          .map((source) => source.source)
          .join(', ')} · hash ${input.sourceHash.slice(0, 12)}`,
      },
      layout: {},
      metadata: {
        reportType: snapshot.type,
        schemaVersion: snapshot.schemaVersion,
        sourceHash: input.sourceHash,
        documentContext: { emitter: input.emitter },
      },
      correlationId: input.correlationId,
      generatedAt: new Date(snapshot.generatedAt),
    };
  }

  private section(
    section: ReportSectionReadModel,
    order: number,
  ): RenderSectionInput {
    const fields: RenderFieldInput[] = [];
    let position = 0;

    if (section.unavailableReason) {
      fields.push({
        id: `${section.id}.unavailable`,
        label: 'Não disponível',
        type: 'TEXT',
        order: position++,
        required: false,
        hidden: false,
        value: section.unavailableReason,
      });
    }

    for (const metric of section.metrics) {
      fields.push({
        id: metric.id,
        label: metric.label,
        type: 'TEXT',
        order: position++,
        required: false,
        hidden: false,
        ...(metric.unit ? { unit: metric.unit } : {}),
        value: metric.value,
        /** A procedência viaja para o papel: quem lê sabe o que é derivado. */
        notes: metric.note
          ? `${metric.note} (${metric.provenance})`
          : metric.provenance,
      });
    }

    for (const table of section.tables) {
      fields.push({
        id: `${table.id}.title`,
        label: table.title,
        type: 'TEXT',
        order: position++,
        required: false,
        hidden: false,
        value: table.rows.length === 0 ? 'Sem registros no período' : '',
        ...(table.note ? { notes: table.note } : {}),
      });

      const [first, ...others] = table.columns;
      for (const [index, row] of table.rows.entries()) {
        fields.push({
          id: `${table.id}.${index}`,
          label: first ? (row[first.key] ?? '—') : `#${index + 1}`,
          type: 'TEXT',
          order: position++,
          required: false,
          hidden: false,
          value: others
            .map((column) => `${column.label}: ${row[column.key] ?? '—'}`)
            .join(' · '),
        });
      }
    }

    return {
      id: section.id,
      title: section.title,
      ...(section.description ? { description: section.description } : {}),
      order,
      type: 'SECTION',
      fields,
    };
  }

  private period(snapshot: ReportSnapshotReadModel): string {
    const from = snapshot.period.from.slice(0, 10);
    const to = snapshot.period.to.slice(0, 10);
    const scope = snapshot.scope.businessUnitName ?? 'Toda a organização';
    return `${from} a ${to} · ${scope} · ${snapshot.period.timezone}`;
  }
}
