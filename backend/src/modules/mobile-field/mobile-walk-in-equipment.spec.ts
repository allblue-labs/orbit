import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { MobileWalkInRepository } from './mobile-walk-in.repository';
import { CreateWalkInOperationDto } from './mobile-walk-in.dto';

const ORG = '01900000-0000-7000-8000-000000000001';
const UNIT = '01900000-0000-7000-8000-000000000002';
const CUSTOMER = '01900000-0000-7000-8000-000000000003';

describe('walk-in equipment contract and persistence', () => {
  it('accepts minimal customer/equipment names without the optional details', async () => {
    const dto = plainToInstance(CreateWalkInOperationDto, {
      customer: { legalName: 'Maria Souza', type: 'INDIVIDUAL' },
      equipment: [{ name: 'Split' }],
    });
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
  });

  it('validates optional identifiers, dates and technical specifications', async () => {
    const dto = plainToInstance(CreateWalkInOperationDto, {
      customerId: CUSTOMER,
      equipment: [
        {
          name: 'Split',
          identifier: 'ET-1',
          identifierType: 'INTERNAL_CODE',
          installationAt: '2026-10-24T00:00:00Z',
          warrantyUntil: '2027-10-24T00:00:00Z',
          specifications: { Capacidade: '12.000 BTU/h', Tensão: '220 V' },
        },
      ],
    });
    expect(
      await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
    ).toEqual([]);
    expect(dto.equipment?.[0]?.installationAt).toEqual(
      new Date('2026-10-24T00:00:00Z'),
    );
    for (const invalid of [
      { installationAt: 'invalid' },
      { identifierType: 'invalid' },
      { specifications: [] },
    ]) {
      const bad = plainToInstance(CreateWalkInOperationDto, {
        customerId: CUSTOMER,
        equipment: [{ name: 'Split', ...invalid }],
      });
      expect((await validate(bad)).length).toBeGreaterThan(0);
    }
  });

  it('persists multiple new equipment records and links them to the same operation/customer/unit', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      operationWalkInCommand: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: UNIT }) },
      customer: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: CUSTOMER, legalName: 'Cliente' }),
      },
      asset: {
        findMany: jest.fn().mockResolvedValue([{ id: 'existing-equipment' }]),
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'new-1' })
          .mockResolvedValueOnce({ id: 'new-2' }),
      },
      customerAddress: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const rls = {
      run: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
    };
    const operations = {
      createWithin: jest.fn().mockResolvedValue({ id: 'operation-1' }),
    };
    const repository = new MobileWalkInRepository(
      rls as never,
      operations as never,
    );
    const installationAt = new Date('2026-10-24T00:00:00Z');
    const warrantyUntil = new Date('2027-10-24T00:00:00Z');
    const result = await repository.create({
      organizationId: ORG,
      businessUnitId: UNIT,
      actorId: 'actor',
      idempotencyKey: 'key-12345',
      payloadHash: 'hash',
      command: {
        customerId: CUSTOMER,
        assetIds: ['existing-equipment'],
        equipment: [
          {
            name: 'Split',
            category: 'EQUIPMENT',
            manufacturer: 'Marca',
            model: 'Modelo',
            serialNumber: '123',
            location: 'Sala',
            identifier: 'ET-1',
            identifierType: 'INTERNAL_CODE',
            installationAt,
            warrantyUntil,
            specifications: { Capacidade: '12.000 BTU/h' },
          },
          { name: 'Outro aparelho' },
        ],
      },
    });
    expect(result).toEqual({ operationId: 'operation-1', created: true });
    expect(tx.asset.create).toHaveBeenCalledTimes(2);
    expect(tx.asset.create).toHaveBeenNthCalledWith(1, {
      data: {
        organizationId: ORG,
        businessUnitId: UNIT,
        customerId: CUSTOMER,
        category: 'EQUIPMENT',
        name: 'Split',
        manufacturer: 'Marca',
        model: 'Modelo',
        serialNumber: '123',
        location: 'Sala',
        identifier: 'ET-1',
        identifierType: 'INTERNAL_CODE',
        installationAt,
        warrantyUntil,
        specifications: { Capacidade: '12.000 BTU/h' },
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    expect(operations.createWithin).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ customerId: CUSTOMER, businessUnitId: UNIT }),
      'actor',
      expect.objectContaining({ assetCount: 3 }),
      [],
      ['existing-equipment', 'new-1', 'new-2'],
    );
    expect(tx.asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['existing-equipment'] },
          organizationId: ORG,
          customerId: CUSTOMER,
          businessUnitId: UNIT,
          deletedAt: null,
        },
      }),
    );
  });
});
