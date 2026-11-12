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
import { imageUploadOptions } from '../storage/image-upload.options';
import { detectImageMime } from '../storage/image-signature';
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
  @UseInterceptors(FileInterceptor('file', imageUploadOptions))
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
    const mimeType = detectImageMime(file.buffer);
    if (!mimeType)
      throw new ValidationException(
        'Imagem inválida.',
        undefined,
        'FILE_INVALID',
      );
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
