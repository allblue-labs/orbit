import { ConflictException, ValidationException } from '../../exceptions';
import { CustomerServiceRequestMapper } from './customer-service-request.mapper';
import { CustomerServiceRequestPolicy } from './customer-service-request.policy';
import { CustomerServiceRequestService } from './customer-service-request.service';

describe('CustomerServiceRequestService', () => {
  const repository = {
    createPortal: jest.fn(),
    convert: jest.fn(),
  };
  const mapper = new CustomerServiceRequestMapper(
    new CustomerServiceRequestPolicy(),
  );
  const service = new CustomerServiceRequestService(
    repository as never,
    mapper,
  );
  const actor = {
    actorType: 'CUSTOMER_PORTAL' as const,
    identityId: '01900000-0000-7000-8000-000000000001',
    sessionId: '01900000-0000-7000-8000-000000000002',
    organizationId: '01900000-0000-7000-8000-000000000003',
    customerId: '01900000-0000-7000-8000-000000000004',
  } as never;

  beforeEach(() => jest.clearAllMocks());

  it('requires a safe Idempotency-Key for Portal create', async () => {
    await expect(
      service.portalCreate(actor, 'short', {
        category: 'QUESTION',
        subject: 'Uma dúvida',
        description: 'Descrição suficiente',
      }),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(repository.createPortal).not.toHaveBeenCalled();
  });

  it('hashes a canonical Portal payload without accepting tenant fields', async () => {
    repository.createPortal.mockRejectedValue(
      new ConflictException('mismatch'),
    );
    await expect(
      service.portalCreate(actor, 'portal-key-0001', {
        category: 'QUESTION',
        subject: 'Uma dúvida',
        description: 'Descrição suficiente',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.createPortal).toHaveBeenCalledWith(
      actor,
      {
        category: 'QUESTION',
        subject: 'Uma dúvida',
        description: 'Descrição suficiente',
      },
      'portal-key-0001',
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });
});
