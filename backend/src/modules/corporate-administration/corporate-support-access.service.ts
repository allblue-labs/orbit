import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { RlsTransaction } from '../../database';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { ConflictException } from '../../exceptions';
import type { CorporateCall } from './corporate-access.guard';
import { authorizedCorporateReference } from './corporate-request';
import {
  DIAGNOSTICS_INTEGRATIONS_READ,
  DIAGNOSTICS_OPERATIONS_READ,
  DIAGNOSTICS_ORGANIZATIONS_READ,
  RECOVERY_PROVISIONING_RESUME,
  SUPPORT_TICKETS_CREATE,
  SUPPORT_TICKETS_READ,
  SUPPORT_TICKETS_UPDATE,
} from './technical-credential.service';

const capabilities = {
  SUPPORT_READ: SUPPORT_TICKETS_READ,
  SUPPORT_CREATE: SUPPORT_TICKETS_CREATE,
  SUPPORT_UPDATE: SUPPORT_TICKETS_UPDATE,
  ORG_DIAGNOSTICS: DIAGNOSTICS_ORGANIZATIONS_READ,
  INTEGRATIONS: DIAGNOSTICS_INTEGRATIONS_READ,
  OPERATIONS: DIAGNOSTICS_OPERATIONS_READ,
  PROVISIONING_RECOVERY: RECOVERY_PROVISIONING_RESUME,
} as const;
type Operation = keyof typeof capabilities;
type Reference = ReturnType<typeof authorizedCorporateReference>;
type WriteOperation =
  'SUPPORT_CREATE' | 'SUPPORT_UPDATE' | 'PROVISIONING_RECOVERY';
type Audit = {
  reference: Reference;
  operation: Operation;
  target: string | null;
};

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class CorporateSupportAccess {
  constructor(private readonly rls: RlsTransaction) {}

  async read<T>(
    call: CorporateCall,
    reference: unknown,
    operation: Exclude<Operation, WriteOperation>,
    target: string | null,
    work: (tx: PrismaTransactionClient) => Promise<T | null>,
  ) {
    const audit = {
      reference: authorizedCorporateReference(
        call,
        reference,
        capabilities[operation],
        false,
      ),
      operation,
      target,
    };
    const result = await this.rls.runAmbient(
      async (tx) => {
        await this.scope(tx, audit);
        const value = await work(tx);
        await this.audit(
          tx,
          audit,
          'READ',
          value === null ? 'NOT_FOUND' : 'CONFIRMED',
        );
        return value;
      },
      { timeout: 12000 },
    );
    if (result === null) throw new NotFoundException();
    return result;
  }

  async write<T extends { id: string }>(
    call: CorporateCall,
    reference: unknown,
    operation: WriteOperation,
    target: string | null,
    key: unknown,
    input: object,
    work: (tx: PrismaTransactionClient, administratorId: string) => Promise<T>,
    reason?: string,
  ) {
    const authentication = authorizedCorporateReference(
      call,
      reference,
      capabilities[operation],
      true,
    );
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{16,128}$/.test(key))
      throw new BadRequestException(
        'Informe uma chave de idempotência válida.',
      );
    const audit = { reference: authentication, operation, target };
    const principal = authentication.technicalPrincipalId;
    const administrator =
      authentication.declaredNexusAdministratorId!.toLowerCase();
    const keyHash = digest(key);
    const requestHash = digest(
      JSON.stringify({ operation, target, administrator, input }),
    );
    await this.writeTransaction(audit, (tx) =>
      this.audit(tx, audit, 'ATTEMPT', 'STARTED', reason),
    );
    try {
      return await this.writeTransaction(audit, async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'corporate-support:' + principal + ':' + keyHash}, 0))::text`;
        const [previous] = await tx.$queryRaw<
          { requestHash: string; receipt: T }[]
        >`
          SELECT request_hash AS "requestHash", receipt FROM public.corporate_support_requests
          WHERE technical_principal_id = ${principal}::uuid AND key_hash = ${keyHash}`;
        if (previous) {
          if (previous.requestHash !== requestHash)
            throw new ConflictException(
              'Chave já usada para outra solicitação.',
              'IDEMPOTENCY_MISMATCH',
            );
          await this.audit(
            tx,
            { ...audit, target: previous.receipt.id },
            'RESULT',
            'REPLAYED',
            reason,
          );
          return { ...previous.receipt, replayed: true };
        }
        if (operation === 'PROVISIONING_RECOVERY')
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'corporate-support-recovery:' + target}, 0))::text`;
        const receipt = await work(tx, administrator);
        await tx.$executeRaw`
          INSERT INTO public.corporate_support_requests (technical_principal_id, key_hash, request_hash, receipt)
          VALUES (${principal}::uuid, ${keyHash}, ${requestHash}, ${JSON.stringify(receipt)}::jsonb)`;
        await this.audit(
          tx,
          { ...audit, target: receipt.id },
          'RESULT',
          'CONFIRMED',
          reason,
        );
        return { ...receipt, replayed: false };
      });
    } catch (error) {
      await this.writeTransaction(audit, (tx) =>
        this.audit(
          tx,
          audit,
          'RESULT',
          error instanceof HttpException && error.getStatus() < 500
            ? 'REJECTED'
            : 'UNCONFIRMED',
          reason,
        ),
      );
      throw error;
    }
  }

  private writeTransaction<T>(
    audit: Audit,
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ) {
    // Keep the recovery guard transaction separate from ADM-03.A's durable stage transactions.
    return this.rls.run(
      async (tx) => {
        await this.scope(tx, audit);
        return work(tx);
      },
      {
        timeout: audit.operation === 'PROVISIONING_RECOVERY' ? 95_000 : 12_000,
      },
    );
  }

  private async scope(
    tx: PrismaTransactionClient,
    { reference, operation, target }: Audit,
  ) {
    const tenant = operation === 'ORG_DIAGNOSTICS' ? (target ?? '') : '';
    await tx.$queryRaw`SELECT
      set_config('app.corporate_support_principal', ${reference.technicalPrincipalId}, true),
      set_config('app.corporate_support_operation', ${operation}, true),
      set_config('app.corporate_support_organization', ${tenant}, true),
      set_config('app.organization_id', ${tenant}, true),
      set_config('statement_timeout', '5s', true)`;
  }

  private async audit(
    tx: PrismaTransactionClient,
    audit: Audit,
    phase: 'READ' | 'ATTEMPT' | 'RESULT',
    outcome: string,
    reason?: string,
  ) {
    const { reference, operation, target } = audit;
    await tx.auditLog.createMany({
      data: {
        entityType: 'CORPORATE_SUPPORT',
        entityId: target,
        action: 'CORPORATE_SUPPORT_' + phase,
        requestId: reference.correlationId,
        metadata: {
          ...reference,
          operation,
          outcome,
          ...(reason ? { reason } : {}),
        } satisfies Prisma.InputJsonObject,
      },
    });
  }
}
