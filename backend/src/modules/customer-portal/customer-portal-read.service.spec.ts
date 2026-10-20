import type { UUID } from '../../contracts';
import { EntityNotFoundException } from '../../exceptions';
import type { FileObjectService } from '../storage/file-object.service';
import { CustomerPortalReadMapper } from './customer-portal-read.mapper';
import type { CustomerPortalReadRepository } from './customer-portal-read.repository';
import { CustomerPortalReadService } from './customer-portal-read.service';
import { CustomerPortalAuthorizationPolicy } from './customer-portal.policy';
import type { CustomerPortalActor } from './customer-portal.types';

describe('CustomerPortalReadService', () => {
  const actor: CustomerPortalActor = {
    actorType: 'CUSTOMER_PORTAL',
    identityId: '01900000-0000-7000-8000-000000000001' as UUID,
    sessionId: '01900000-0000-7000-8000-000000000002' as UUID,
    organizationId: '01900000-0000-7000-8000-000000000003' as UUID,
    customerId: '01900000-0000-7000-8000-000000000004' as UUID,
  };

  const repository = {
    dashboard: jest.fn(),
    listOperations: jest.fn(),
    findOperation: jest.fn(),
    listAssets: jest.fn(),
    findAsset: jest.fn(),
    listPmoc: jest.fn(),
    findPmoc: jest.fn(),
    listRvt: jest.fn(),
    findRvt: jest.fn(),
    listDocuments: jest.fn(),
    findDocument: jest.fn(),
  };
  const files = { sign: jest.fn() };
  const service = new CustomerPortalReadService(
    repository as unknown as CustomerPortalReadRepository,
    new CustomerPortalReadMapper(),
    new CustomerPortalAuthorizationPolicy(),
    files as unknown as FileObjectService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('derives list scope exclusively from the authenticated actor', async () => {
    repository.listOperations.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    await service.operations(actor, {
      page: 1,
      limit: 20,
      order: 'desc',
      sortBy: 'date',
    });
    expect(repository.listOperations).toHaveBeenCalledWith(
      {
        organizationId: actor.organizationId,
        customerId: actor.customerId,
      },
      expect.any(Object),
      undefined,
    );
  });

  it('returns hidden absence and never signs a foreign document', async () => {
    repository.findDocument.mockResolvedValue({
      organizationId: actor.organizationId,
      execution: { customerId: 'foreign-customer' },
      file: {
        bucket: 'internal',
        objectKey: 'foreign/file.pdf',
        fileName: 'foreign.pdf',
        mimeType: 'application/pdf',
      },
    });
    await expect(
      service.documentAccess(actor, 'document-id'),
    ).rejects.toBeInstanceOf(EntityNotFoundException);
    expect(files.sign).not.toHaveBeenCalled();
  });

  it('signs an eligible own document for five minutes without exposing storage metadata', async () => {
    repository.findDocument.mockResolvedValue({
      organizationId: actor.organizationId,
      execution: { customerId: actor.customerId },
      file: {
        bucket: 'internal',
        objectKey: 'own/file.pdf',
        fileName: 'relatorio.pdf',
        mimeType: 'application/pdf',
      },
    });
    files.sign.mockResolvedValue({
      url: 'https://storage.example/signed',
      expiresAt: new Date('2026-09-04T12:05:00.000Z'),
      method: 'GET',
      requiredHeaders: {},
    });
    const result = await service.documentAccess(actor, 'document-id');
    expect(files.sign).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'relatorio.pdf' }),
      'download',
      300,
    );
    expect(result).toEqual({
      url: 'https://storage.example/signed',
      expiresAt: '2026-09-04T12:05:00.000Z',
      method: 'GET',
    });
    expect(JSON.stringify(result)).not.toMatch(/bucket|objectKey/);
  });
});
