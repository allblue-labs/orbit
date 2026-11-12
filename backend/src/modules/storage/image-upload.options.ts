import { memoryStorage } from 'multer';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { ValidationException } from '../../exceptions';
import { ACCEPTED_IMAGE_MIME_TYPES } from './image-signature';
export const imageUploadOptions: MulterOptions = {
  storage: memoryStorage(),
  limits: { fileSize: 10_000_000, files: 1, fields: 0 },
  fileFilter: (_request, file, callback) => {
    const valid = (ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(
      file.mimetype,
    );
    callback(
      valid ? null : new ValidationException('Envie JPEG, PNG, WebP ou HEIC.'),
      valid,
    );
  },
};
