import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RlsTransaction } from '../../database';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
} from '../../exceptions';

@Injectable()
export class MobileSignatureRepository {
  constructor(private readonly rls: RlsTransaction) {}

  context(organizationId: string, userId: string) {
    return this.rls.run(async (tx) => {
      const membership = await tx.organizationMembership.findFirst({
        where: { organizationId, userId, status: 'ACTIVE', deletedAt: null },
        select: { id: true },
      });
      const profile = await tx.professionalProfile.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
        select: {
          active: true,
          fieldTechnicianEnabled: true,
          technicalResponsibleEnabled: true,
        },
      });
      const signature = await tx.userSignature.findFirst({
        where: { organizationId, userId, active: true, revokedAt: null },
        select: {
          id: true,
          version: true,
          updatedAt: true,
          sha256: true,
          storageObject: {
            select: {
              bucket: true,
              objectKey: true,
              fileName: true,
              mimeType: true,
              sizeBytes: true,
              sha256: true,
              status: true,
            },
          },
        },
      });
      return { membership, profile, signature };
    });
  }

  storageFile(organizationId: string, id: string) {
    return this.rls.run((tx) =>
      tx.storageFile.findFirst({
        where: { id, organizationId, status: 'AVAILABLE', deletedAt: null },
      }),
    );
  }

  signatureUploadFile(organizationId: string, id: string) {
    return this.rls.run((tx) =>
      tx.storageFile.findFirst({
        where: { id, organizationId, deletedAt: null },
        select: { id: true, createdById: true },
      }),
    );
  }

  replace(
    organizationId: string,
    userId: string,
    storageObjectId: string,
    sha256: string,
  ) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mobile-signature:${organizationId}:${userId}`}))`;
      const current = await tx.userSignature.findFirst({
        where: { organizationId, userId, active: true, revokedAt: null },
      });
      const latest = await tx.userSignature.aggregate({
        where: { organizationId, userId },
        _max: { version: true },
      });
      if (current)
        await tx.userSignature.update({
          where: { id: current.id },
          data: { active: false, revokedAt: new Date() },
        });
      const signature = await tx.userSignature.create({
        data: {
          organizationId,
          userId,
          storageObjectId,
          sha256,
          version: (latest._max.version ?? 0) + 1,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'professional.signature.updated',
          entityType: 'USER_SIGNATURE',
          entityId: signature.id,
          before: current ? { version: current.version } : undefined,
          after: { version: signature.version, signatureAvailable: true },
        },
      });
      return { signature, replacedVersion: current?.version ?? null };
    });
  }

  revoke(organizationId: string, userId: string) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`mobile-signature:${organizationId}:${userId}`}))`;
      const current = await tx.userSignature.findFirst({
        where: { organizationId, userId, active: true, revokedAt: null },
      });
      if (!current) return false;
      await tx.userSignature.update({
        where: { id: current.id },
        data: { active: false, revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId,
          action: 'professional.signature.revoked',
          entityType: 'USER_SIGNATURE',
          entityId: current.id,
          before: { version: current.version, signatureAvailable: true },
          after: { version: current.version, signatureAvailable: false },
        },
      });
      return true;
    });
  }

  operation(organizationId: string, operationId: string) {
    return this.rls.run((tx) =>
      tx.operation.findFirst({
        where: { id: operationId, organizationId, deletedAt: null },
        include: {
          customer: { select: { id: true, legalName: true, tradeName: true } },
          /** O termo de assinatura lista todos os equipamentos atendidos. */
          assets: {
            orderBy: { createdAt: 'asc' as const },
            select: {
              asset: { select: { id: true, identifier: true, name: true } },
            },
          },
          auxiliaryTechnicians: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      }),
    );
  }

  acknowledgement(organizationId: string, executionId: string) {
    return this.rls.run((tx) =>
      tx.customerAcknowledgement.findFirst({
        where: {
          organizationId,
          executionType: 'OPERATION',
          executionId,
          invalidatedAt: null,
        },
        orderBy: { acknowledgedAt: 'desc' },
      }),
    );
  }

  capture(input: {
    organizationId: string;
    businessUnitId: string;
    executionId: string;
    customerId: string | null;
    contactId?: string;
    signerName: string;
    signatureStorageFileId?: string;
    signatureSha256?: string;
    contentVersion: string;
    contentHash: string;
    summary: Prisma.InputJsonValue;
    commandId: string;
    payloadHash: string;
    actorId: string;
    occurredAt?: Date;
  }) {
    return this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-ack:${input.organizationId}:OPERATION:${input.executionId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-ack-command:${input.organizationId}:${input.actorId}:${input.commandId}`}))`;
      const replay = await tx.customerAcknowledgement.findUnique({
        where: {
          organizationId_capturedByUserId_commandId: {
            organizationId: input.organizationId,
            capturedByUserId: input.actorId,
            commandId: input.commandId,
          },
        },
      });
      if (replay) {
        if (replay.payloadHash !== input.payloadHash)
          throw new ConflictException(
            'Idempotency key reused with a different acknowledgement payload',
          );
        return { acknowledgement: replay, idempotentReplay: true };
      }
      const operation = await tx.operation.findFirst({
        where: {
          id: input.executionId,
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          deletedAt: null,
        },
        include: {
          auxiliaryTechnicians: {
            where: { removedAt: null },
            select: { userId: true },
          },
        },
      });
      if (!operation)
        throw new EntityNotFoundException('Operation', input.executionId);
      if (input.contactId) {
        const contact = await tx.contact.findFirst({
          where: {
            id: input.contactId,
            organizationId: input.organizationId,
            customerId: input.customerId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!contact)
          throw new ForbiddenException('Contato fora do contexto do cliente');
      }
      if (operation.updatedAt.toISOString() !== input.contentVersion)
        throw new ConflictException(
          'O atendimento foi alterado. Revise os dados antes de coletar uma nova assinatura.',
        );
      const assigned =
        operation.responsibleFieldTechnicianId === input.actorId ||
        operation.startedByUserId === input.actorId ||
        operation.completedByUserId === input.actorId;
      if (!assigned)
        throw new ForbiddenException(
          'Somente o Técnico em Campo efetivo pode coletar o reconhecimento',
        );
      await tx.customerAcknowledgement.updateMany({
        where: {
          organizationId: input.organizationId,
          executionType: 'OPERATION',
          executionId: input.executionId,
          invalidatedAt: null,
        },
        data: { invalidatedAt: new Date(), invalidationReason: 'REPLACED' },
      });
      const acknowledgement = await tx.customerAcknowledgement.create({
        data: {
          organizationId: input.organizationId,
          businessUnitId: input.businessUnitId,
          executionType: 'OPERATION',
          executionId: input.executionId,
          customerId: input.customerId,
          contactId: input.contactId,
          signerName: input.signerName,
          signatureStorageFileId: input.signatureStorageFileId,
          signatureSha256: input.signatureSha256,
          contentVersion: input.contentVersion,
          contentHash: input.contentHash,
          summarySnapshot: input.summary,
          commandId: input.commandId,
          payloadHash: input.payloadHash,
          capturedByUserId: input.actorId,
          occurredAt: input.occurredAt,
        },
      });
      await tx.operationHistory.create({
        data: {
          operationId: input.executionId,
          userId: input.actorId,
          action: 'CUSTOMER_ACKNOWLEDGEMENT_CAPTURED',
          details: {
            acknowledgementId: acknowledgement.id,
            signerName: input.signerName,
            hasSignature: Boolean(input.signatureStorageFileId),
          },
        },
      });
      return { acknowledgement, idempotentReplay: false };
    });
  }
}
