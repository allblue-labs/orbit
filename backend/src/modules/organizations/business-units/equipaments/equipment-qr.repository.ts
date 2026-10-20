import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../../../database';

const equipmentSelect = {
  id: true,
  organizationId: true,
  businessUnitId: true,
  customerId: true,
  category: true,
  name: true,
  manufacturer: true,
  model: true,
  serialNumber: true,
  identifier: true,
  location: true,
  specifications: true,
  status: true,
  deletedAt: true,
  businessUnit: {
    select: {
      id: true,
      legalName: true,
      tradeName: true,
      logoUrl: true,
      street: true,
      number: true,
      district: true,
      city: true,
      stateCode: true,
    },
  },
  customer: {
    select: {
      id: true,
      legalName: true,
      tradeName: true,
      address: true,
      contacts: {
        where: { deletedAt: null },
        orderBy: [
          { isPrimary: 'desc' as const },
          { createdAt: 'asc' as const },
        ],
        take: 1,
        select: { name: true, phone: true, email: true },
      },
    },
  },
} satisfies Prisma.AssetSelect;

@Injectable()
export class EquipmentQrRepository {
  constructor(private readonly rls: RlsTransaction) {}

  hash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  identityForEquipment(equipmentId: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.equipmentQrIdentity.findFirst({
        where: { equipmentId, organizationId, status: 'ACTIVE' },
        include: {
          equipment: { select: equipmentSelect },
          organization: { select: { displayName: true, logoUrl: true } },
        },
      }),
    );
  }

  identityByTokenHash(tokenHash: string, organizationId: string) {
    return this.rls.run((tx) =>
      tx.equipmentQrIdentity.findFirst({
        where: { tokenHash, organizationId, status: 'ACTIVE' },
        include: { equipment: { select: equipmentSelect } },
      }),
    );
  }

  ensure(equipmentId: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const equipment = await tx.asset.findFirst({
        where: { id: equipmentId, organizationId },
        select: { id: true },
      });
      if (!equipment) return null;
      await tx.$queryRaw`SELECT ensure_equipment_qr_identity(${equipmentId}::uuid)`;
      return tx.equipmentQrIdentity.findFirst({
        where: { equipmentId, organizationId, status: 'ACTIVE' },
      });
    });
  }

  rotate(equipmentId: string, organizationId: string, actorId: string) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`equipment-qr:${equipmentId}`}, 0))`;
      const equipment = await tx.asset.findFirst({
        where: { id: equipmentId, organizationId },
        select: { id: true, organizationId: true, businessUnitId: true },
      });
      if (!equipment) return null;
      const previous = await tx.equipmentQrIdentity.findFirst({
        where: { equipmentId, status: 'ACTIVE' },
        select: { id: true },
      });
      const now = new Date();
      await tx.equipmentQrIdentity.updateMany({
        where: { equipmentId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now, rotatedAt: now },
      });
      const token = randomBytes(32).toString('base64url');
      const identity = await tx.equipmentQrIdentity.create({
        data: {
          organizationId: equipment.organizationId,
          businessUnitId: equipment.businessUnitId,
          equipmentId,
          token,
          tokenHash: this.hash(token),
          rotatedAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          businessUnitId: equipment.businessUnitId,
          userId: actorId,
          action: 'EQUIPMENT_QR_ROTATED',
          entityType: 'EQUIPMENT_QR_IDENTITY',
          entityId: identity.id,
          before: previous ? { identityId: previous.id } : Prisma.JsonNull,
          after: { identityId: identity.id, status: 'ACTIVE' },
        },
      });
      return identity;
    });
  }

  revoke(equipmentId: string, organizationId: string, actorId: string) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`equipment-qr:${equipmentId}`}, 0))`;
      const equipment = await tx.asset.findFirst({
        where: { id: equipmentId, organizationId },
        select: { businessUnitId: true },
      });
      if (!equipment) return null;
      const identity = await tx.equipmentQrIdentity.findFirst({
        where: { equipmentId, status: 'ACTIVE' },
      });
      if (!identity) return { revoked: false };
      await tx.equipmentQrIdentity.update({
        where: { id: identity.id },
        data: { status: 'REVOKED', revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          businessUnitId: equipment.businessUnitId,
          userId: actorId,
          action: 'EQUIPMENT_QR_REVOKED',
          entityType: 'EQUIPMENT_QR_IDENTITY',
          entityId: identity.id,
          before: { status: 'ACTIVE' },
          after: { status: 'REVOKED' },
        },
      });
      return { revoked: true };
    });
  }

  fieldContext(equipmentId: string, organizationId: string) {
    return this.rls.run(async (tx) => {
      const lastService = await tx.operation.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          /** O atendimento aponta para os equipamentos pela tabela de vínculo. */
          assets: { some: { assetId: equipmentId } },
        },
        orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          completedAt: true,
          createdAt: true,
          kind: true,
          status: true,
        },
      });
      const coverages = await tx.pmocEquipmentCoverage.findMany({
        where: { organizationId, assetId: equipmentId, deletedAt: null },
        include: {
          plan: {
            select: {
              id: true,
              name: true,
              status: true,
              startsOn: true,
              endsOn: true,
              schedulingPaused: true,
              nextDueOn: true,
              executions: {
                where: { status: 'PENDING' },
                orderBy: { dueOn: 'asc' },
                take: 1,
                select: {
                  id: true,
                  dueOn: true,
                  status: true,
                  equipmentExecutions: {
                    where: { assetId: equipmentId },
                    select: { id: true },
                  },
                },
              },
            },
          },
        },
      });
      const rvtExecutions = await tx.rvtExecution.findMany({
        where: {
          organizationId,
          status: 'IN_PROGRESS',
          occurrence: {
            configuration: {
              equipment: { none: { assetId: equipmentId, removedAt: null } },
            },
          },
        },
        select: {
          id: true,
          businessUnitId: true,
          occurrence: {
            select: { configuration: { select: { customerId: true } } },
          },
        },
      });
      return { lastService, coverages, rvtExecutions };
    });
  }
}
