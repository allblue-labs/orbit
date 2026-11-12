import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import {
  ReportStatus,
  type ReportStatus as ReportStatusType,
} from '../../contracts';
import {
  ConflictException,
  EntityNotFoundException,
  ValidationException,
} from '../../exceptions';
import { documentHash } from '../document-engine/canonical-document';
import type {
  DocumentSettings,
  DocumentSection,
  SignatureSlot,
} from '../document-engine/document-engine.types';
import { DocumentStorageService } from '../document-engine/document-storage.service';
import { PdfRendererService } from '../document-engine/pdf-renderer.service';
import type {
  ChangeReportStatusDto,
  CreateReportDto,
  ReportQueryDto,
  UpdateReportDto,
} from './dto/report.dto';
import { ReportRepository } from './report.repository';

const transitions: Readonly<Record<ReportStatusType, ReportStatusType[]>> = {
  DRAFT: [ReportStatus.IN_REVIEW],
  IN_REVIEW: [ReportStatus.DRAFT, ReportStatus.APPROVED],
  APPROVED: [ReportStatus.IN_REVIEW, ReportStatus.ARCHIVED],
  PUBLISHED: [ReportStatus.ARCHIVED],
  ARCHIVED: [],
};

@Injectable()
export class ReportService {
  constructor(
    private readonly repository: ReportRepository,
    private readonly renderer: PdfRendererService,
    private readonly storage: DocumentStorageService,
  ) {}

  async list(organizationId: string, query: ReportQueryDto) {
    if (
      query.createdFrom &&
      query.createdTo &&
      query.createdTo < query.createdFrom
    ) {
      throw new ValidationException('Invalid report creation interval');
    }
    const result = await this.repository.list(organizationId, query);
    return {
      ...result,
      data: result.data.map((report) => this.publicReport(report)),
    };
  }

  async get(id: string, organizationId: string) {
    const report = await this.repository.find(id, organizationId);
    if (!report) throw new EntityNotFoundException('Report', id);
    return this.publicReport(report);
  }

  async create(
    organizationId: string,
    actorId: string,
    input: CreateReportDto,
  ) {
    const [template, references] = await Promise.all([
      this.repository.findTemplate(input.templateId, organizationId),
      this.validateReferences(
        organizationId,
        input.businessUnitId,
        input.customerId,
        input.operationId,
      ),
    ]);
    if (!template) throw new ValidationException('Invalid report template');
    const customerId = input.customerId ?? references.operationCustomerId;
    const snapshot = {
      templateId: template.id,
      templateVersion: template.version,
      code: input.code.trim().toUpperCase(),
      title: input.title,
      businessUnitId: input.businessUnitId,
      operationId: input.operationId ?? null,
      customerId: customerId ?? null,
      sections: template.sections,
      signatureSlots: template.signatureSlots,
      renderSettings: template.settings,
      data: input.data ?? {},
    };
    try {
      const report = await this.repository.create({
        organizationId,
        businessUnitId: input.businessUnitId,
        templateId: template.id,
        operationId: input.operationId,
        customerId,
        createdById: actorId,
        code: snapshot.code,
        title: snapshot.title,
        templateVersion: template.version,
        sections: template.sections as Prisma.InputJsonValue,
        signatureSlots: template.signatureSlots as Prisma.InputJsonValue,
        renderSettings: template.settings as Prisma.InputJsonValue,
        data: (input.data ?? {}) as Prisma.InputJsonValue,
        contentHash: documentHash(snapshot),
      });
      return this.publicReport(report);
    } catch (error) {
      this.mapConflict(error);
    }
  }

  async update(id: string, organizationId: string, input: UpdateReportDto) {
    const current = await this.raw(id, organizationId);
    if (current.status !== ReportStatus.DRAFT || current.lockedAt) {
      throw new ConflictException('Only unlocked draft reports can be edited');
    }
    const title = input.title ?? current.title;
    const data = input.data ?? (current.data as Record<string, unknown>);
    const contentHash = documentHash({
      templateId: current.templateId,
      templateVersion: current.templateVersion,
      code: current.code,
      title,
      businessUnitId: current.businessUnitId,
      operationId: current.operationId,
      customerId: current.customerId,
      sections: current.sections,
      signatureSlots: current.signatureSlots,
      renderSettings: current.renderSettings,
      data,
    });
    const report = await this.repository.update(id, {
      title: input.title,
      data: input.data as Prisma.InputJsonValue | undefined,
      contentHash,
    });
    return this.publicReport(report);
  }

  async changeStatus(
    id: string,
    organizationId: string,
    input: ChangeReportStatusDto,
  ) {
    const current = await this.raw(id, organizationId);
    const from = current.status;
    if (
      input.status === ReportStatus.PUBLISHED ||
      !transitions[from]?.includes(input.status)
    ) {
      throw new ValidationException(
        `Status transition from ${from} to ${input.status} is not allowed`,
      );
    }
    const changed = await this.repository.changeStatus(id, from, input.status);
    if (!changed) {
      throw new ConflictException(
        'Report status changed concurrently; reload and try again',
      );
    }
    return this.publicReport(changed);
  }

  async render(id: string, organizationId: string) {
    const report = await this.raw(id, organizationId);
    if (report.status === ReportStatus.ARCHIVED) {
      throw new ConflictException('Archived reports cannot be rendered');
    }
    const pdf = await this.renderer.render({
      title: report.title,
      code: report.code,
      version: report.templateVersion,
      sections: report.sections as unknown as DocumentSection[],
      signatureSlots: report.signatureSlots as unknown as SignatureSlot[],
      settings: report.renderSettings as unknown as DocumentSettings,
      data: report.data as Record<string, unknown>,
      signatures: report.signatures,
      contentHash: report.contentHash,
    });
    const stored = await this.storage.store(pdf, organizationId);
    try {
      const document = await this.repository.createDocument(
        id,
        organizationId,
        report.contentHash,
        stored,
      );
      return this.publicDocument(document);
    } catch (error) {
      await this.storage.remove(stored.storageKey).catch(() => undefined);
      throw error;
    }
  }

  async finalize(id: string, organizationId: string) {
    const report = await this.raw(id, organizationId);
    if (report.status !== ReportStatus.APPROVED) {
      throw new ConflictException('Only approved reports can be finalized');
    }
    const slots = report.signatureSlots as unknown as SignatureSlot[];
    const signed = new Set(
      report.signatures
        .filter(
          (signature) =>
            signature.reportContentHash === report.contentHash &&
            !signature.revokedAt,
        )
        .map((signature) => signature.slotKey),
    );
    const missing = slots.filter(
      (slot) => slot.required && !signed.has(slot.key),
    );
    if (missing.length > 0) {
      throw new ValidationException('Required signatures are pending', {
        slots: missing.map((slot) => slot.key),
      });
    }
    const document = await this.render(id, organizationId);
    const published = await this.repository.publish(id);
    return { report: this.publicReport(published), document };
  }

  async documents(id: string, organizationId: string) {
    await this.raw(id, organizationId);
    return (await this.repository.listDocuments(id)).map((document) =>
      this.publicDocument(document),
    );
  }

  async download(reportId: string, documentId: string, organizationId: string) {
    await this.raw(reportId, organizationId);
    const document = await this.repository.findDocument(documentId, reportId);
    if (!document) {
      throw new EntityNotFoundException('Generated document', documentId);
    }
    const buffer = await this.storage.read(document.storageKey);
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (hash !== document.sha256) {
      throw new ConflictException('Generated document integrity check failed');
    }
    return { document, buffer };
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const report = await this.raw(id, organizationId);
    if (report.status !== ReportStatus.DRAFT) {
      throw new ConflictException('Only draft reports can be deleted');
    }
    await this.repository.softDelete(id);
  }

  private raw(id: string, organizationId: string) {
    return this.repository.find(id, organizationId).then((report) => {
      if (!report) throw new EntityNotFoundException('Report', id);
      return report;
    });
  }

  private async validateReferences(
    organizationId: string,
    businessUnitId: string,
    customerId?: string,
    operationId?: string,
  ) {
    const unit = await this.repository.findBusinessUnit(
      businessUnitId,
      organizationId,
    );
    if (!unit) throw new ValidationException('Invalid business unit');
    if (customerId) {
      const customer = await this.repository.findCustomer(
        customerId,
        organizationId,
      );
      if (!customer) throw new ValidationException('Invalid customer');
    }
    const operation = operationId
      ? await this.repository.findOperation(
          operationId,
          organizationId,
          businessUnitId,
        )
      : null;
    if (operationId && !operation) {
      throw new ValidationException(
        'Operation is not available in the report business unit',
      );
    }
    if (
      operation?.customerId &&
      customerId &&
      operation.customerId !== customerId
    ) {
      throw new ValidationException('Operation belongs to another customer');
    }
    return { operationCustomerId: operation?.customerId };
  }

  private publicReport<T extends { documents: { sizeBytes: bigint }[] }>(
    report: T,
  ) {
    return {
      ...report,
      documents: report.documents.map((document) =>
        this.publicDocument(document),
      ),
    };
  }

  private publicDocument<T extends { sizeBytes: bigint }>(document: T) {
    return { ...document, sizeBytes: document.sizeBytes.toString() };
  }

  private mapConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Report code is already in use');
    }
    throw error;
  }
}
