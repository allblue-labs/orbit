import { Injectable } from '@nestjs/common';
import { Prisma, type QuoteAcceptanceLink } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService, RlsTransaction } from '../../database';
import { RequestContext, RequestContextStorage } from '../../context';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { HashHelper } from '../../helpers';
import { generateUuidV7 } from '../../utils';
import type { UUID } from '../../contracts';
import { FileObjectService } from '../storage/file-object.service';
import { QuoteService } from './quote.service';
import { QuoteMapper } from './quote.mapper';
import { QuoteRepository } from './quote.repository';
import { QuoteAcceptedDocumentService } from './quote-accepted-document.service';
import type { QuoteAcceptanceResponseDto } from './quote-acceptance.dto';
import type {
  QuoteAcceptanceReadModel,
  QuoteAcceptanceSnapshot,
  QuoteCustomerDecision,
} from './quote-acceptance.read-models';

interface LinkContext {
  link_id: UUID;
  organization_id: UUID;
  business_unit_id: UUID;
  quote_id: UUID;
}

@Injectable()
export class QuoteAcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rls: RlsTransaction,
    private readonly contexts: RequestContextStorage,
    private readonly quotes: QuoteService,
    private readonly repository: QuoteRepository,
    private readonly mapper: QuoteMapper,
    private readonly files: FileObjectService,
    private readonly acceptedDocuments: QuoteAcceptedDocumentService,
  ) {}

  async create(id: string, organizationId: string, actorId: string) {
    let quote = await this.quotes.get(id, organizationId);
    if (quote.status === 'DRAFT')
      quote = await this.quotes.send(id, organizationId, actorId);
    if (quote.status !== 'SENT')
      throw new ConflictException(
        'Somente propostas prontas para análise podem receber um link de aceite.',
      );
    const detail = this.mapper.detail(quote);
    const document = await this.quotes.document(id, organizationId);
    const snapshot: QuoteAcceptanceSnapshot = {
      code: detail.code,
      title: detail.title,
      introText: detail.introText,
      notes: detail.notes,
      customerName: detail.customer.displayName,
      emitterName: detail.businessUnit.name,
      validUntil: detail.validUntil,
      currency: detail.currency,
      subtotal: detail.subtotal,
      discount: detail.discount,
      total: detail.total,
      serviceAddress: detail.serviceAddress?.summary ?? null,
      equipment: detail.assets.map(({ name, identifier, location }) => ({
        name,
        identifier,
        location,
      })),
      items: detail.items.map(
        ({
          description,
          quantity,
          unit,
          unitPrice,
          discount,
          total,
          notes,
        }) => ({
          description,
          quantity,
          unit,
          unitPrice,
          discount,
          total,
          notes,
        }),
      ),
    };
    const stored = await this.files.store({
      organizationId,
      businessUnitId: detail.businessUnit.id,
      namespace: 'attachments',
      fileName: document.fileName,
      mimeType: 'application/pdf',
      body: document.bytes,
      createdById: actorId,
      metadata: { purpose: 'QUOTE_CUSTOMER_ACCEPTANCE', quoteId: id },
    });
    const token = randomBytes(48).toString('base64url');
    const expiresAt = new Date(
      Math.min(
        Date.now() + 72 * 3600_000,
        quote.validUntil ? quote.validUntil.getTime() + 86400_000 : Infinity,
      ),
    );
    await this.rls.run(async (tx) => {
      await tx.$executeRaw`SELECT id FROM quotes WHERE id=${id}::uuid AND organization_id=${organizationId}::uuid FOR UPDATE`;
      const current = await tx.quote.findFirst({
        where: { id, organizationId, deletedAt: null },
      });
      if (
        !current ||
        current.status !== 'SENT' ||
        current.updatedAt.getTime() !== quote.updatedAt.getTime()
      )
        throw new ConflictException(
          'A proposta mudou durante a geração. Atualize e gere um novo link.',
        );
      await tx.quoteAcceptanceLink.updateMany({
        where: {
          quoteId: id,
          organizationId,
          respondedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
      await tx.quoteAcceptanceLink.create({
        data: {
          organizationId,
          businessUnitId: detail.businessUnit.id,
          quoteId: id,
          tokenHash: HashHelper.sha256(token),
          quoteVersion: quote.updatedAt,
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          documentFileId: stored.id,
          expiresAt,
          createdById: actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          businessUnitId: detail.businessUnit.id,
          userId: actorId,
          action: 'QUOTE_ACCEPTANCE_LINK_CREATED',
          entityType: 'QUOTE',
          entityId: id,
          after: {
            expiresAt: expiresAt.toISOString(),
            documentSha256: stored.sha256,
          },
        },
      });
    });
    return { token, expiresAt: expiresAt.toISOString(), code: detail.code };
  }

  async latest(id: string, organizationId: string) {
    await this.quotes.get(id, organizationId);
    return this.rls.run(async (tx) => {
      const link = await tx.quoteAcceptanceLink.findFirst({
        where: { quoteId: id, organizationId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (!link) return null;
      return {
        state: (await this.view(link, tx)).state,
        expiresAt: link.expiresAt.toISOString(),
        decision: link.decision,
        signerName: link.signerName,
        respondedAt: link.respondedAt?.toISOString() ?? null,
        reason: link.reason,
      };
    });
  }

  read(token: string) {
    return this.scoped(token, async (tx, context) =>
      this.view(await this.link(tx, context), tx),
    );
  }

  document(token: string) {
    return this.scoped(token, async (tx, context) => {
      const link = await this.link(tx, context);
      const view = await this.view(link, tx);
      if (!['AVAILABLE', 'COMPLETED'].includes(view.state))
        throw new ConflictException(
          'Este link não permite baixar a proposta. Peça um link atualizado.',
        );
      const file = await tx.storageFile.findFirstOrThrow({
        where: {
          id: link.documentFileId,
          organizationId: link.organizationId,
          status: 'AVAILABLE',
        },
      });
      let bytes = await this.files.read(file.bucket, file.objectKey);
      if (FileObjectService.hash(bytes) !== file.sha256)
        throw new ConflictException(
          'Não foi possível conferir o documento enviado.',
        );
      if (
        link.decision === 'APPROVE' &&
        link.respondedAt &&
        link.signatureFileId &&
        link.consentAccepted
      ) {
        const signatureFile = await tx.storageFile.findFirstOrThrow({
          where: {
            id: link.signatureFileId,
            organizationId: link.organizationId,
            status: 'AVAILABLE',
            mimeType: 'image/png',
          },
        });
        const signature = await this.files.read(
          signatureFile.bucket,
          signatureFile.objectKey,
        );
        if (FileObjectService.hash(signature) !== signatureFile.sha256)
          throw new ConflictException(
            'Não foi possível conferir a assinatura do cliente.',
          );
        bytes = await this.acceptedDocuments.render(bytes, {
          code: (link.snapshot as unknown as QuoteAcceptanceSnapshot).code,
          signerName: link.signerName!,
          signedAt: link.respondedAt,
          originalSha256: file.sha256,
          signature,
        });
      }
      return {
        bytes,
        fileName: `orcamento-${(link.snapshot as unknown as QuoteAcceptanceSnapshot).code.replace(/[^A-Za-z0-9_-]/g, '_')}.pdf`,
      };
    });
  }

  async respond(
    token: string,
    input: QuoteAcceptanceResponseDto,
    evidence: { ip?: string; userAgent?: string },
  ) {
    if (input.decision !== 'APPROVE' && (input.reason?.trim().length ?? 0) < 5)
      throw new ValidationException(
        'Explique o motivo da recusa ou o que precisa ser alterado (ao menos 5 caracteres).',
      );
    let signature: Buffer | undefined;
    if (input.decision === 'APPROVE') {
      if (input.consentAccepted !== true)
        throw new ValidationException(
          'Confirme que leu e autoriza esta proposta antes de assinar.',
        );
      if (!input.signatureBase64)
        throw new ValidationException(
          'Desenhe sua assinatura para aprovar o orçamento.',
        );
      signature = Buffer.from(
        input.signatureBase64.replace(/^data:image\/png;base64,/, ''),
        'base64',
      );
      try {
        const metadata = await sharp(signature, {
          limitInputPixels: 4_000_000,
        }).metadata();
        if (metadata.format !== 'png' || signature.length > 525000)
          throw new Error('invalid');
      } catch {
        throw new ValidationException(
          'A assinatura precisa ser uma imagem PNG válida de até 512 KB.',
        );
      }
    }
    return this.scoped(token, async (tx, context) => {
      // Mesma ordem de locks da geração; conteúdo e resposta são decididos juntos.
      await tx.$executeRaw`SELECT id FROM quotes WHERE id=${context.quote_id}::uuid AND organization_id=${context.organization_id}::uuid FOR UPDATE`;
      await tx.$executeRaw`SELECT id FROM quote_acceptance_links WHERE id=${context.link_id}::uuid FOR UPDATE`;
      const link = await this.link(tx, context);
      const before = await this.view(link, tx);
      if (before.state === 'COMPLETED') {
        if (before.response?.decision !== input.decision)
          throw new ConflictException(
            'Uma resposta diferente já foi registrada para esta proposta.',
          );
        return before;
      }
      if (before.state !== 'AVAILABLE')
        throw new ConflictException(
          'Este link não está mais disponível para resposta. Peça uma proposta atualizada.',
        );
      const file = signature
        ? await this.files.storeWith(tx, {
            organizationId: link.organizationId,
            businessUnitId: link.businessUnitId,
            namespace: 'signatures',
            fileName: 'aceite-cliente.png',
            mimeType: 'image/png',
            body: signature,
            createdById: null,
            metadata: {
              purpose: 'QUOTE_CUSTOMER_ACCEPTANCE',
              quoteId: link.quoteId,
              documentFileId: link.documentFileId,
            },
          })
        : null;
      const now = new Date();
      const to =
        input.decision === 'APPROVE'
          ? 'APPROVED'
          : input.decision === 'REJECT'
            ? 'REJECTED'
            : 'DRAFT';
      const updated = await this.repository.transition({
        id: link.quoteId,
        organizationId: link.organizationId,
        businessUnitId: link.businessUnitId,
        actorId: null,
        from: ['SENT'],
        to,
        data: {
          decidedAt: input.decision === 'REQUEST_CHANGES' ? null : now,
          decidedById: null,
          closingReason: input.reason?.trim().slice(0, 500) ?? null,
        },
        action:
          input.decision === 'APPROVE'
            ? 'QUOTE_APPROVED'
            : input.decision === 'REJECT'
              ? 'QUOTE_REJECTED'
              : 'QUOTE_CHANGES_REQUESTED',
        details: {
          source: 'CUSTOMER_LINK',
          signerName: input.signerName,
          linkId: link.id,
          documentFileId: link.documentFileId,
          reason: input.reason ?? null,
        },
        event: input.decision === 'APPROVE',
      });
      if (!updated)
        throw new ConflictException(
          'A proposta já recebeu uma decisão. Atualize a página.',
        );
      const response = await tx.quoteAcceptanceLink.update({
        where: { id: link.id },
        data: {
          decision: input.decision,
          respondedAt: now,
          signerName: input.signerName,
          signerDocument: input.signerDocument,
          signerEmail: input.signerEmail,
          reason: input.reason?.trim(),
          signatureFileId: file?.id,
          consentAccepted: input.consentAccepted === true,
          responseIp: evidence.ip?.slice(0, 64),
          responseUserAgent: evidence.userAgent?.slice(0, 400),
        },
      });
      return this.view(response, tx);
    });
  }

  private state(link: QuoteAcceptanceLink): QuoteAcceptanceReadModel['state'] {
    if (link.respondedAt) return 'COMPLETED';
    if (link.revokedAt) return 'REVOKED';
    if (link.expiresAt.getTime() <= Date.now()) return 'EXPIRED';
    return 'AVAILABLE';
  }
  private async view(
    link: QuoteAcceptanceLink,
    tx: Prisma.TransactionClient,
  ): Promise<QuoteAcceptanceReadModel> {
    let state = this.state(link);
    if (state === 'AVAILABLE') {
      const quote = await tx.quote.findFirst({
        where: {
          id: link.quoteId,
          organizationId: link.organizationId,
          deletedAt: null,
        },
        select: { status: true, updatedAt: true },
      });
      if (
        !quote ||
        quote.status !== 'SENT' ||
        quote.updatedAt.getTime() !== link.quoteVersion.getTime()
      )
        state = 'UPDATED';
    }
    return {
      state,
      proposal: ['AVAILABLE', 'COMPLETED'].includes(state)
        ? (link.snapshot as unknown as QuoteAcceptanceSnapshot)
        : null,
      expiresAt: link.expiresAt.toISOString(),
      response: link.respondedAt
        ? {
            decision: link.decision as QuoteCustomerDecision,
            signerName: link.signerName!,
            respondedAt: link.respondedAt.toISOString(),
            reason: link.reason,
          }
        : null,
    };
  }
  private async link(tx: Prisma.TransactionClient, context: LinkContext) {
    const link = await tx.quoteAcceptanceLink.findFirst({
      where: {
        id: context.link_id,
        organizationId: context.organization_id,
        quoteId: context.quote_id,
        businessUnitId: context.business_unit_id,
      },
    });
    if (!link) throw new EntityNotFoundException('Proposta');
    return link;
  }
  private async scoped<T>(
    token: string,
    work: (tx: Prisma.TransactionClient, context: LinkContext) => Promise<T>,
  ): Promise<T> {
    if (!/^[A-Za-z0-9_-]{64}$/.test(token))
      throw new EntityNotFoundException('Proposta');
    const rows = await this.prisma.$queryRaw<
      LinkContext[]
    >`SELECT * FROM app_quote_acceptance_resolve(${HashHelper.sha256(token)})`;
    const context = rows[0];
    if (!context) throw new EntityNotFoundException('Proposta');
    return this.contexts.run(
      new RequestContext({
        requestId: generateUuidV7(),
        actorType: 'SYSTEM',
        userId: null,
        organizationId: context.organization_id,
        businessUnitId: context.business_unit_id,
        businessUnitIds: [context.business_unit_id],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      }),
      () => this.rls.runAmbient((tx) => work(tx, context)),
    );
  }
}
