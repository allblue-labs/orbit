import { ProductKind } from '../../contracts';
import { EntityNotFoundException, ValidationException } from '../../exceptions';
import type { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  const repository = {
    findCategory: jest.fn(),
    createCategory: jest.fn(),
    findAvailableProduct: jest.fn(),
  };
  const service = new CatalogService(
    repository as unknown as CatalogRepository,
    {} as never,
    {} as never,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('normalizes category slugs', async () => {
    repository.createCategory.mockResolvedValue({ id: 'category-id' });
    await service.createCategory('organization-id', {
      name: 'Peças e Serviços',
    });
    expect(repository.createCategory).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'pecas-e-servicos' }),
    );
  });

  it('rejects a category that is its own parent', async () => {
    repository.findCategory.mockResolvedValue({ id: 'category-id' });
    await expect(
      service.updateCategory('category-id', 'organization-id', {
        parentId: 'category-id',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('exposes only products available to the target business unit', async () => {
    repository.findAvailableProduct.mockResolvedValue(null);
    await expect(
      service.findAvailableForBusinessUnit(
        'product-id',
        'organization-id',
        'business-unit-id',
      ),
    ).rejects.toBeInstanceOf(EntityNotFoundException);

    repository.findAvailableProduct.mockResolvedValue({
      id: 'product-id',
      kind: ProductKind.PRODUCT,
    });
    await expect(
      service.findAvailableForBusinessUnit(
        'product-id',
        'organization-id',
        'business-unit-id',
      ),
    ).resolves.toMatchObject({ id: 'product-id' });
  });
});
