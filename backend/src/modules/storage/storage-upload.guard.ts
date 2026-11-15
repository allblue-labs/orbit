import { TenantOperationPolicy } from '../tenant-operations/tenant-operation.policy';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { ForbiddenException } from '../../exceptions';
import { STORAGE_CONFIG, type StorageConfig } from './storage.config';
import { verifyUploadGrant } from './upload-grant';
/** Validate the capability before Multer allocates memory for the multipart body. */
@Injectable()
export class StorageUploadGuard implements CanActivate {
  constructor(
    @Inject(STORAGE_CONFIG) private readonly config: StorageConfig,
    private readonly policy: TenantOperationPolicy,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const { query } = context.switchToHttp().getRequest<Request>();
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
    return true;
  }
}
