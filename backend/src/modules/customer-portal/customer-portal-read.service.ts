import { Injectable } from '@nestjs/common';
import { EntityNotFoundException } from '../../exceptions';
import { FileObjectService } from '../storage/file-object.service';
import type {
  CustomerPortalAssetDetailsReadModel,
  CustomerPortalAssetListItemReadModel,
  CustomerPortalDashboardReadModel,
  CustomerPortalDocumentAccessReadModel,
  CustomerPortalDocumentReadModel,
  CustomerPortalOperationDetailsReadModel,
  CustomerPortalOperationListItemReadModel,
  CustomerPortalPageReadModel,
  CustomerPortalPmocDetailsReadModel,
  CustomerPortalPmocListItemReadModel,
  CustomerPortalRvtDetailsReadModel,
  CustomerPortalRvtListItemReadModel,
} from './customer-portal.read-models';
import type {
  CustomerPortalAssetListQueryDto,
  CustomerPortalDocumentListQueryDto,
  CustomerPortalOperationListQueryDto,
  CustomerPortalPmocListQueryDto,
  CustomerPortalRvtListQueryDto,
} from './customer-portal-read.dto';
import { CustomerPortalReadMapper } from './customer-portal-read.mapper';
import { CustomerPortalReadRepository } from './customer-portal-read.repository';
import { CustomerPortalAuthorizationPolicy } from './customer-portal.policy';
import type { CustomerPortalActor } from './customer-portal.types';

const OPERATION_STATUS: Readonly<Record<string, string>> = {
  open: 'OPEN',
  scheduled: 'SCHEDULED',
  inProgress: 'IN_PROGRESS',
  paused: 'PAUSED',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

const ASSET_STATUS: Readonly<Record<string, string>> = {
  active: 'ACTIVE',
  inactive: 'INACTIVE',
  maintenance: 'MAINTENANCE',
  retired: 'RETIRED',
};

const PMOC_STATUS: Readonly<Record<string, string>> = {
  draft: 'DRAFT',
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
};

const RVT_STATUS: Readonly<Record<string, string>> = {
  active: 'ACTIVE',
  inactive: 'INACTIVE',
  completed: 'COMPLETED',
  cancelled: 'CANCELLED',
};

@Injectable()
export class CustomerPortalReadService {
  constructor(
    private readonly repository: CustomerPortalReadRepository,
    private readonly mapper: CustomerPortalReadMapper,
    private readonly policy: CustomerPortalAuthorizationPolicy,
    private readonly files: FileObjectService,
  ) {}

  dashboard(
    actor: CustomerPortalActor,
  ): Promise<CustomerPortalDashboardReadModel> {
    return this.repository.dashboard(this.policy.scope(actor));
  }

  async operations(
    actor: CustomerPortalActor,
    query: CustomerPortalOperationListQueryDto,
  ): Promise<
    CustomerPortalPageReadModel<CustomerPortalOperationListItemReadModel>
  > {
    const page = await this.repository.listOperations(
      this.policy.scope(actor),
      query,
      query.status ? OPERATION_STATUS[query.status] : undefined,
    );
    return this.mapper.page(page, (value) => this.mapper.operation(value));
  }

  async operation(
    actor: CustomerPortalActor,
    id: string,
  ): Promise<CustomerPortalOperationDetailsReadModel> {
    const value = await this.repository.findOperation(
      this.policy.scope(actor),
      id,
    );
    this.policy.assertOwns(actor, value, 'Operation');
    return this.mapper.operationDetails(value);
  }

  async assets(
    actor: CustomerPortalActor,
    query: CustomerPortalAssetListQueryDto,
  ): Promise<
    CustomerPortalPageReadModel<CustomerPortalAssetListItemReadModel>
  > {
    const page = await this.repository.listAssets(
      this.policy.scope(actor),
      query,
      query.status ? ASSET_STATUS[query.status] : undefined,
    );
    return this.mapper.page(page, (value) => this.mapper.asset(value));
  }

  async asset(
    actor: CustomerPortalActor,
    id: string,
  ): Promise<CustomerPortalAssetDetailsReadModel> {
    const value = await this.repository.findAsset(this.policy.scope(actor), id);
    this.policy.assertOwns(actor, value, 'Asset');
    return this.mapper.assetDetails(value);
  }

  async pmoc(
    actor: CustomerPortalActor,
    query: CustomerPortalPmocListQueryDto,
  ): Promise<CustomerPortalPageReadModel<CustomerPortalPmocListItemReadModel>> {
    const page = await this.repository.listPmoc(
      this.policy.scope(actor),
      query,
      query.status ? PMOC_STATUS[query.status] : undefined,
    );
    return this.mapper.page(page, (value) => this.mapper.pmoc(value));
  }

  async pmocDetails(
    actor: CustomerPortalActor,
    id: string,
  ): Promise<CustomerPortalPmocDetailsReadModel> {
    const value = await this.repository.findPmoc(this.policy.scope(actor), id);
    this.policy.assertOwns(actor, value, 'PMOC plan');
    return this.mapper.pmocDetails(value);
  }

  async rvt(
    actor: CustomerPortalActor,
    query: CustomerPortalRvtListQueryDto,
  ): Promise<CustomerPortalPageReadModel<CustomerPortalRvtListItemReadModel>> {
    const page = await this.repository.listRvt(
      this.policy.scope(actor),
      query,
      query.status ? RVT_STATUS[query.status] : undefined,
    );
    return this.mapper.page(page, (value) => this.mapper.rvt(value));
  }

  async rvtDetails(
    actor: CustomerPortalActor,
    id: string,
  ): Promise<CustomerPortalRvtDetailsReadModel> {
    const value = await this.repository.findRvt(this.policy.scope(actor), id);
    this.policy.assertOwns(actor, value, 'RVT configuration');
    return this.mapper.rvtDetails(value);
  }

  async documents(
    actor: CustomerPortalActor,
    query: CustomerPortalDocumentListQueryDto,
  ): Promise<CustomerPortalPageReadModel<CustomerPortalDocumentReadModel>> {
    const page = await this.repository.listDocuments(
      this.policy.scope(actor),
      query,
    );
    return this.mapper.page(page, (value) => this.mapper.document(value));
  }

  async documentAccess(
    actor: CustomerPortalActor,
    id: string,
  ): Promise<CustomerPortalDocumentAccessReadModel> {
    const value = await this.repository.findDocument(
      this.policy.scope(actor),
      id,
    );
    if (!value) throw new EntityNotFoundException('Document');
    this.policy.assertOwns(
      actor,
      {
        organizationId: value.organizationId,
        customerId: value.execution.customerId,
      },
      'Document',
    );
    if (!value.file) throw new EntityNotFoundException('Document');
    const signed = await this.files.sign(
      {
        bucket: value.file.bucket,
        objectKey: value.file.objectKey,
        fileName: value.file.fileName,
        mimeType: value.file.mimeType,
      },
      'download',
      300,
    );
    return this.mapper.documentAccess(signed);
  }
}
