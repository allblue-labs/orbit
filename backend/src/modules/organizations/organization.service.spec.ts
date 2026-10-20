import { ValidationException } from '../../exceptions';
import { BusinessUnitType } from '../../contracts';
import type { OrganizationRepository } from './organization.repository';
import { OrganizationService } from './organization.service';
import type { AuthorizationService } from '../../common';

describe('OrganizationService', () => {
  const repository = { create: jest.fn() };
  /* O caminho exercitado aqui (normalização de slug) não consulta
     autorização; o stub existe para o construtor, não para o teste. */
  const service = new OrganizationService(
    repository as unknown as OrganizationRepository,
    {} as unknown as AuthorizationService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('normalizes organization and primary unit slugs', async () => {
    repository.create.mockResolvedValue({ id: 'organization-id' });
    await service.create('owner-id', {
      displayName: 'Órbita Serviços',
      primarySegment: 'HVAC',
      planKey: 'PRO',
      primaryBusinessUnit: {
        legalName: 'Órbita Recife Ltda',
        type: BusinessUnitType.HEADQUARTERS,
        documentType: 'CNPJ',
        documentNumber: '11.222.333/0001-81',
        city: 'Recife',
        street: 'Rua Azul',
      },
    });

    expect(repository.create).toHaveBeenCalledWith(
      'owner-id',
      expect.any(Object),
      'orbita-servicos',
      'orbita-recife-ltda',
    );
  });

  it('rejects an unknown plan returned by the repository', async () => {
    repository.create.mockResolvedValue(null);
    await expect(
      service.create('owner-id', {
        displayName: 'Orbit',
        primarySegment: 'HVAC',
        planKey: 'UNKNOWN',
        primaryBusinessUnit: {
          legalName: 'Orbit HQ',
          type: BusinessUnitType.HEADQUARTERS,
          documentType: 'CNPJ',
          documentNumber: '11.222.333/0001-81',
          city: 'Recife',
          street: 'Rua Azul',
        },
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });
});
