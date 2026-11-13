import { readEmbeddedImage } from '../../src/common/embedded-image';
import { ValidationException } from '../../src/exceptions';
import type { BrandImageService } from '../../src/modules/storage/brand-image.service';
/** Domain tests keep storage I/O isolated; BrandImageService has dedicated integration coverage. */
export function brandImageStub(): BrandImageService {
  return {
    url: (value: string | null) => Promise.resolve(value),
    read: (value?: string | null) => Promise.resolve(readEmbeddedImage(value)),
    store: (_organizationId: string, _ownerId: string, value: string) => {
      if (!readEmbeddedImage(value))
        throw new ValidationException('Imagem inválida.');
      return Promise.resolve(value);
    },
    remove: () => Promise.resolve(),
  } as unknown as BrandImageService;
}
