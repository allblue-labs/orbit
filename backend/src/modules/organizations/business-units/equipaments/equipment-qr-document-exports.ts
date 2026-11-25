/**
 * Exportação assíncrona da etiqueta de QR do equipamento.
 *
 * Os parâmetros (formato, tamanho, marca) são os mesmos da rota síncrona,
 * validados pelo mesmo DTO no pedido e relidos por lista fechada no worker.
 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { RlsTransaction } from '../../../../database';
import { EntityNotFoundException } from '../../../../exceptions';
import { DocumentExportGeneratorRegistry } from '../../../document-exports/document-export.registry';
import { DocumentExportService } from '../../../document-exports/document-export.service';
import type {
  DocumentExportGenerator,
  GeneratedDocument,
} from '../../../document-exports/document-export.types';
import { EquipmentQrRenderQueryDto } from './equipment-qr.dto';
import {
  EquipmentQrService,
  type EquipmentQrActor,
} from './equipment-qr.service';

const FORMATS = ['svg', 'png', 'pdf'] as const;
const PRESETS = ['SMALL', 'STANDARD'] as const;
const BRANDINGS = ['NONE', 'ORGANIZATION', 'BUSINESS_UNIT'] as const;

function pick<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

@Injectable()
export class EquipmentQrDocumentExports
  implements DocumentExportGenerator, OnModuleInit
{
  readonly kinds = ['EQUIPMENT_QR'] as const;

  constructor(
    private readonly generators: DocumentExportGeneratorRegistry,
    private readonly exports: DocumentExportService,
    private readonly rls: RlsTransaction,
    private readonly qr: EquipmentQrService,
  ) {}

  onModuleInit(): void {
    this.generators.register(this);
  }

  /** `POST /assets/:id/qr/exports`. */
  async request(
    id: string,
    actor: EquipmentQrActor,
    query: EquipmentQrRenderQueryDto,
  ) {
    const asset = await this.rls.run((tx) =>
      tx.asset.findFirst({
        where: { id, organizationId: actor.organizationId },
        select: { id: true, businessUnitId: true },
      }),
    );
    if (!asset || !actor.businessUnitIds.includes(asset.businessUnitId))
      throw new EntityNotFoundException('Equipment');
    return this.exports.request({
      kind: 'EQUIPMENT_QR',
      entityId: asset.id,
      businessUnitId: asset.businessUnitId,
      params: {
        format: query.format,
        preset: query.preset,
        branding: query.branding,
      },
    });
  }

  async generate({
    export: row,
    job,
  }: Parameters<
    DocumentExportGenerator['generate']
  >[0]): Promise<GeneratedDocument> {
    const params = (row.params ?? {}) as Record<string, unknown>;
    const query = Object.assign(new EquipmentQrRenderQueryDto(), {
      format: pick(params.format, FORMATS, 'svg'),
      preset: pick(params.preset, PRESETS, 'STANDARD'),
      branding: pick(params.branding, BRANDINGS, 'NONE'),
    });
    const rendered = await this.qr.render(
      row.entityId,
      {
        organizationId: row.organizationId,
        actorId: job.actorUserId ?? '',
        businessUnitIds: job.businessUnitIds,
        permissions: [],
      },
      query,
    );
    return {
      bytes: Buffer.from(rendered.bytes),
      fileName: rendered.fileName,
      contentType: rendered.contentType,
    };
  }
}
