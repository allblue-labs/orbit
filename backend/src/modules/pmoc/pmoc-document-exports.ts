/**
 * Exportação assíncrona do documento do plano PMOC.
 *
 * O pedido confere que o plano existe para quem pede (RLS da requisição); o
 * worker gera pelo mesmo `PmocService.document` da rota síncrona.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RlsTransaction } from '../../database';
import { EntityNotFoundException } from '../../exceptions';
import { DocumentExportGeneratorRegistry } from '../document-exports/document-export.registry';
import { DocumentExportService } from '../document-exports/document-export.service';
import type {
  DocumentExportGenerator,
  GeneratedDocument,
} from '../document-exports/document-export.types';
import { PmocService, type PmocActor } from './pmoc.service';

@Injectable()
export class PmocDocumentExports
  implements DocumentExportGenerator, OnModuleInit
{
  readonly kinds = ['PMOC_PLAN'] as const;

  constructor(
    private readonly generators: DocumentExportGeneratorRegistry,
    private readonly exports: DocumentExportService,
    private readonly rls: RlsTransaction,
    private readonly pmoc: PmocService,
  ) {}

  onModuleInit(): void {
    this.generators.register(this);
  }

  /** `POST /pmoc/plans/:id/document/exports`. */
  async request(id: string, actor: PmocActor) {
    const plan = await this.rls.run((tx) =>
      tx.pmocPlan.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: { id: true, businessUnitId: true },
      }),
    );
    if (!plan) throw new EntityNotFoundException('PmocPlan', id);
    return this.exports.request({
      kind: 'PMOC_PLAN',
      entityId: plan.id,
      businessUnitId: plan.businessUnitId,
    });
  }

  async generate({
    export: row,
    job,
  }: Parameters<
    DocumentExportGenerator['generate']
  >[0]): Promise<GeneratedDocument> {
    /* O ator do worker carrega só o escopo de dados: a autorização aconteceu
       no pedido, e o documento do plano lê pelo RLS do contexto reaberto. */
    const document = await this.pmoc.document(row.entityId, {
      organizationId: row.organizationId,
      actorId: job.actorUserId ?? '',
      permissions: [],
      businessUnitIds: job.businessUnitIds,
      isOrganizationOwner: false,
    });
    return {
      bytes: Buffer.from(document.bytes),
      fileName: document.fileName,
      contentType: document.mimeType,
    };
  }
}
