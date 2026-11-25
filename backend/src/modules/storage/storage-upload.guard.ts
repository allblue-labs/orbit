import type { Response } from 'express';
import { TenantOperationPolicy } from '../tenant-operations/tenant-operation.policy';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ForbiddenException } from '../../exceptions';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import { verifyUploadGrant } from './upload-grant';
import { FileObjectService } from './file-object.service';
import { RequestContext, RequestContextStorage } from '../../context';
import type { UUID } from '../../contracts';
import {
  UPLOAD_RESERVATION,
  closeUploadRequest,
  type UploadRequest,
} from './upload-context';
/** Validate the capability before Multer allocates memory for the multipart body. */
@Injectable()
export class StorageUploadGuard implements CanActivate {
  constructor(
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly policy: TenantOperationPolicy,
    private readonly files: FileObjectService,
    private readonly contexts: RequestContextStorage,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<UploadRequest>();
    try {
      const { query } = req;
      if (
        query.operation !== 'upload' ||
        typeof query.bucket !== 'string' ||
        typeof query.key !== 'string' ||
        typeof query.expires !== 'string' ||
        !/^\d+$/.test(query.expires) ||
        typeof query.signature !== 'string' ||
        !/^[a-f0-9]{64}$/.test(query.signature) ||
        !verifyUploadGrant(this.config, {
          bucket: query.bucket,
          key: query.key,
          expires: Number(query.expires),
          signature: query.signature,
        })
      )
        throw new ForbiddenException(
          'Invalid or expired upload signature',
          'STORAGE_SIGNATURE_INVALID',
        );
      const organizationId = query.key.split('/')[1];
      if (!organizationId || !/^[0-9a-f-]{36}$/.test(organizationId))
        throw new ForbiddenException('Invalid upload scope');
      await this.policy.assertCapabilityTenant(organizationId);
      const uploadContext = new RequestContext({
        requestId: 'signed-upload',
        actorType: 'INTERNAL_USER',
        userId: null,
        organizationId: organizationId as UUID,
        businessUnitId: null,
        businessUnitIds: [],
        roles: [],
        permissions: [],
        ip: null,
        userAgent: null,
        locale: 'pt-BR',
      });
      const reserved = await this.contexts.run(uploadContext, () =>
        this.files.describeUpload(
          organizationId,
          query.bucket as string,
          query.key as string,
        ),
      );
      req[UPLOAD_RESERVATION] = {
        id: reserved.file.id,
        sizeBytes: reserved.sizeBytes,
        mimeType: reserved.mimeType,
        context: uploadContext,
      };
      return true;
    } catch (error) {
      closeUploadRequest(req, context.switchToHttp().getResponse<Response>());
      throw error;
    }
  }
}
