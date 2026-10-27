import {
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import sharp from 'sharp';
import { Permissions, Surfaces } from '../../decorators';
import { ForbiddenException, ValidationException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import {
  RequiresActivePlan,
  Capabilities,
} from '../subscription-plans/plan-access';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  FileObjectService,
  STORAGE_NAMESPACES,
} from '../storage/file-object.service';
import { PmocRepository } from './pmoc.repository';

@ApiTags('PMOC')
@Controller('pmoc/equipment-executions')
@Surfaces('WEB')
@RequiresActivePlan()
export class PmocWebEvidenceController {
  constructor(
    private readonly repository: PmocRepository,
    private readonly files: FileObjectService,
  ) {}

  @Post(':executionId/evidence/upload')
  @Capabilities('pmoc.manage')
  @Permissions('pmoc.manage')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10_000_000, files: 1 },
    }),
  )
  async upload(
    @Req() request: IdentityRequest,
    @Param('executionId', ParseUUIDv7Pipe) executionId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const actor = request.identity;
    if (!actor?.organizationId) throw new ForbiddenException();
    if (!file?.buffer.length)
      throw new ValidationException(
        'Image required',
        undefined,
        'FILE_INVALID',
      );
    let format: string | undefined;
    try {
      format = (
        await sharp(file.buffer, { limitInputPixels: 40_000_000 }).metadata()
      ).format;
    } catch {
      throw new ValidationException('Invalid image', undefined, 'FILE_INVALID');
    }
    if (!format || !['png', 'jpeg', 'webp'].includes(format))
      throw new ValidationException(
        'Unsupported image',
        undefined,
        'FILE_INVALID',
      );
    const mimeType = `image/${format}`;
    return this.repository.uploadEquipmentPhoto({
      organizationId: actor.organizationId,
      businessUnitIds: actor.businessUnitIds,
      executionId,
      actorId: actor.id,
      store: (tx, businessUnitId) =>
        this.files.storeWith(tx, {
          organizationId: actor.organizationId!,
          businessUnitId,
          namespace: STORAGE_NAMESPACES.evidence,
          fileName: file.originalname.replace(/[\\/\r\n]/g, '_').slice(0, 255),
          mimeType,
          body: file.buffer,
          createdById: actor.id,
          metadata: { source: 'WEB_PMOC', executionId },
        }),
    });
  }
}
