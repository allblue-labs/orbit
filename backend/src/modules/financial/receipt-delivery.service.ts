import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import { EntityNotFoundException } from '../../exceptions';
import { ArtifactExecutionService } from '../artifact-executions/artifact-execution.service';
import { ArtifactManifestService } from '../artifact-manifests/artifact-manifest.service';
import { ArtifactRenderService } from '../artifact-rendering/artifact-render.service';
import { RECEIPT_ARTIFACT_TYPES } from './financial.constants';

export interface ReceiptDeliveryActor {
  organizationId: string;
  actorId: string;
  unitIds: readonly string[];
  ownOnly: boolean;
}

@Injectable()
export class ReceiptDeliveryService {
  constructor(
    private readonly rls: RlsTransaction,
    private readonly executions: ArtifactExecutionService,
    private readonly renderer: ArtifactRenderService,
    private readonly manifests: ArtifactManifestService,
  ) {}

  list(
    actor: ReceiptDeliveryActor,
    page: number,
    limit: number,
    unitId?: string,
  ) {
    const where = this.scope(actor, unitId);
    return this.rls.run(async (tx) => {
      const data = await tx.artifactExecution.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          code: true,
          title: true,
          status: true,
          renderStatus: true,
          createdAt: true,
        },
      });
      const total = await tx.artifactExecution.count({ where });
      return {
        data,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    });
  }

  async render(id: string, actor: ReceiptDeliveryActor) {
    await this.rls.runAmbient(async (tx) => {
      await tx.$executeRaw`SELECT id FROM artifact_executions WHERE id=${id}::uuid AND organization_id=${actor.organizationId}::uuid FOR UPDATE`;
      const receipt = await tx.artifactExecution.findFirst({
        where: { ...this.scope(actor), id },
        select: { status: true },
      });
      if (!receipt) throw new EntityNotFoundException('Receipt', id);
      if (receipt.status === 'DRAFT' || receipt.status === 'IN_PROGRESS') {
        const actorUser = await tx.user.findUniqueOrThrow({
          where: { id: actor.actorId },
          select: { displayName: true },
        });
        await this.executions.signReceiptAsIssuer(
          id,
          actor.organizationId,
          actor.actorId,
          actorUser.displayName,
        );
      }
      if (receipt.status === 'DRAFT')
        await this.executions.changeStatus(
          id,
          actor.organizationId,
          actor.actorId,
          { status: 'IN_PROGRESS' },
        );
      if (receipt.status === 'DRAFT' || receipt.status === 'IN_PROGRESS')
        await this.executions.changeStatus(
          id,
          actor.organizationId,
          actor.actorId,
          { status: 'UNDER_REVIEW' },
        );
    });

    return this.renderer.request(id, actor, { metadata: {} });
  }

  async download(id: string, actor: ReceiptDeliveryActor) {
    const file = await this.rls.run((tx) =>
      tx.artifactManifest.findFirst({
        where: {
          executionId: id,
          organizationId: actor.organizationId,
          execution: this.scope(actor),
          format: 'PDF',
          status: 'ISSUED',
          isActive: true,
          deletedAt: null,
        },
        select: { id: true },
      }),
    );
    if (!file) throw new EntityNotFoundException('Receipt PDF', id);
    return this.manifests.signDownload(file.id, actor, 'download');
  }

  private scope(
    actor: ReceiptDeliveryActor,
    unitId?: string,
  ): Prisma.ArtifactExecutionWhereInput {
    return {
      organizationId: actor.organizationId,
      businessUnitId: {
        in: actor.unitIds.filter((id) => !unitId || id === unitId),
      },
      ...(actor.ownOnly ? { createdById: actor.actorId } : {}),
      deletedAt: null,
      snapshot: { artifactType: { in: [...RECEIPT_ARTIFACT_TYPES] } },
    };
  }
}
