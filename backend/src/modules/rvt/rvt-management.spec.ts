/* Prisma transaction fixtures use partial mocks rather than generated clients. */
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { RvtRepository } from './rvt.repository';
import { RvtService, type RvtActor } from './rvt.service';
import { RvtMapper } from './rvt.mapper';
import { CreateRvtOccurrenceDto, UpdateRvtConfigurationDto } from './rvt.dto';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

const actor: RvtActor = {
  organizationId: 'org',
  actorId: 'tech',
  businessUnitIds: ['unit'],
  permissions: ['rvt.read', 'rvt.execute'],
};
const configuration = {
  id: 'config',
  organizationId: 'org',
  businessUnitId: 'unit',
  customerId: 'customer',
  name: 'Visita mensal',
  timezone: 'America/Recife',
  calendarId: 'calendar',
  startTime: '09:00',
  defaultResponsibleFieldTechnicianId: 'tech',
  equipment: [{ assetId: 'asset1' }, { assetId: 'asset2' }],
};
const current = {
  id: 'visit',
  configurationId: 'config',
  organizationId: 'org',
  sequenceNumber: 2,
  scheduledFor: new Date('2027-01-10T12:00:00Z'),
  localScheduledDate: new Date('2027-01-10'),
  originalScheduledDate: new Date('2027-01-10'),
  equipmentIds: ['asset1', 'asset2'],
  responsibleFieldTechnicianId: 'tech',
  status: 'SCHEDULED',
  schedulingEventId: 'event',
  execution: null,
};

function scenario(visit: any = current) {
  const tx = {
    $executeRaw: jest.fn(),
    rvtConfiguration: {
      findFirstOrThrow: jest.fn().mockResolvedValue(configuration),
    },
    rvtOccurrence: {
      findFirstOrThrow: jest.fn().mockResolvedValue(visit),
      aggregate: jest.fn().mockResolvedValue({ _max: { sequenceNumber: 8 } }),
      create: jest.fn().mockImplementation(({ data }) => ({
        id: 'new',
        status: 'SCHEDULED',
        ...data,
      })),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) => ({
          ...visit,
          ...Object.fromEntries(
            Object.entries(data).filter(([, value]) => value !== undefined),
          ),
        })),
    },
    rvtConfigurationEquipment: {
      findMany: jest.fn().mockResolvedValue(configuration.equipment),
    },
    businessUnit: { findFirst: jest.fn().mockResolvedValue({ id: 'unit' }) },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: 'customer' }) },
    asset: {
      count: jest.fn().mockImplementation(({ where }) => where.id.in.length),
    },
    organization: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ settings: null }),
    },
    organizationMembership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'member' }),
    },
    businessUnitMembership: {
      findFirst: jest.fn().mockResolvedValue({ id: 'membership' }),
    },
    professionalProfile: {
      findFirst: jest.fn().mockResolvedValue({ id: 'profile' }),
    },
    schedulingCalendar: {
      findFirst: jest.fn().mockResolvedValue({ id: 'calendar' }),
    },
    schedulingEvent: {
      upsert: jest.fn().mockResolvedValue({ id: 'event' }),
      update: jest.fn(),
    },
    schedulingResourceAllocation: { deleteMany: jest.fn(), create: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const repository = new RvtRepository({
    run: (callback: any) => callback(tx),
  } as never);
  return { tx, repository };
}

describe('RVT visit management', () => {
  it('creates a visit with configuration equipment, technician and the chosen calendar', async () => {
    const { tx, repository } = scenario();
    await repository.manageOccurrence('config', 'org', 'owner', {
      scheduledDate: '2027-02-10',
      scheduledFor: new Date('2027-02-10T17:30:00Z'),
    });
    expect(tx.rvtOccurrence.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequenceNumber: 9,
        equipmentIds: ['asset1', 'asset2'],
        responsibleFieldTechnicianId: 'tech',
        customized: true,
      }),
    });
    expect(tx.schedulingEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          calendarId: 'calendar',
          startsAt: new Date('2027-02-10T17:30:00Z'),
        }),
      }),
    );
    expect(tx.schedulingCalendar.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 'calendar',
          organizationId: 'org',
          OR: [{ businessUnitId: 'unit' }, { businessUnitId: null }],
        }),
      }),
    );
  });

  it('reschedules, assigns a different technician and selects a subset of equipment atomically', async () => {
    const { tx, repository } = scenario();
    const when = new Date('2027-01-12T17:30:00Z');
    await repository.manageOccurrence(
      'config',
      'org',
      'owner',
      {
        scheduledDate: '2027-01-12',
        scheduledFor: when,
        responsibleFieldTechnicianId: 'replacement',
        equipmentIds: ['asset2'],
      },
      'visit',
    );
    expect(tx.rvtOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledFor: when,
          originalScheduledDate: current.originalScheduledDate,
          equipmentIds: ['asset2'],
          responsibleFieldTechnicianId: 'replacement',
          customized: true,
        }),
      }),
    );
    expect(tx.schedulingEvent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ startsAt: when }),
      }),
    );
    expect(tx.schedulingResourceAllocation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'replacement',
        eventId: 'event',
      }),
    });
  });

  it('clears the technician without retaining the previous calendar allocation', async () => {
    const { tx, repository } = scenario();
    await repository.manageOccurrence(
      'config',
      'org',
      'owner',
      { responsibleFieldTechnicianId: null },
      'visit',
    );
    expect(tx.schedulingResourceAllocation.deleteMany).toHaveBeenCalledWith({
      where: { eventId: 'event' },
    });
    expect(tx.schedulingResourceAllocation.create).not.toHaveBeenCalled();
    expect(tx.rvtOccurrence.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ responsibleFieldTechnicianId: null }),
      }),
    );
  });

  it.each([false, true])(
    'cancels the calendar and preserves audit (remove=%s), even after equipment or technician deactivation',
    async (remove) => {
      const { tx, repository } = scenario();
      tx.professionalProfile.findFirst.mockResolvedValue(null);
      tx.asset.count.mockResolvedValue(0);
      await repository.manageOccurrence(
        'config',
        'org',
        'owner',
        { status: 'CANCELLED' },
        'visit',
        remove,
      );
      expect(tx.schedulingEvent.update).toHaveBeenCalledWith({
        where: { id: 'event' },
        data: {
          status: 'CANCELLED',
          ...(remove ? { deletedAt: expect.any(Date) } : {}),
        },
      });
      expect(tx.auditLog.create).toHaveBeenCalled();
      if (remove)
        expect(tx.rvtOccurrence.update).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              localScheduledDate: null,
              originalScheduledDate: current.originalScheduledDate,
            }),
          }),
        );
      expect(tx.rvtOccurrence.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CANCELLED',
            deletedAt: remove ? expect.any(Date) : null,
          }),
        }),
      );
    },
  );

  it('does not change an already started visit', async () => {
    const { tx, repository } = scenario({
      ...current,
      execution: { id: 'execution' },
      status: 'IN_PROGRESS',
    });
    await expect(
      repository.manageOccurrence('config', 'org', 'owner', {}, 'visit', true),
    ).rejects.toThrow('RVT_VISIT_ALREADY_STARTED');
    expect(tx.rvtOccurrence.update).not.toHaveBeenCalled();
    expect(tx.schedulingEvent.update).not.toHaveBeenCalled();
  });

  it('rejects equipment from another customer or outside the RVT selection', async () => {
    const { tx, repository } = scenario();
    tx.asset.count.mockResolvedValueOnce(0);
    await expect(
      repository.manageOccurrence(
        'config',
        'org',
        'owner',
        { equipmentIds: ['foreign'] },
        'visit',
      ),
    ).rejects.toThrow('BUSINESS_UNIT_SCOPE_INVALID');
    expect(tx.asset.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        organizationId: 'org',
        businessUnitId: 'unit',
        customerId: 'customer',
      }),
    });
    await expect(
      repository.manageOccurrence(
        'config',
        'org',
        'owner',
        { equipmentIds: ['unselected'] },
        'visit',
      ),
    ).rejects.toThrow('RVT_VISIT_EQUIPMENT_OUTSIDE_CONFIGURATION');
    expect(tx.rvtOccurrence.update).not.toHaveBeenCalled();
  });

  it('requires at least one equipment', async () => {
    const { repository } = scenario();
    await expect(
      repository.manageOccurrence(
        'config',
        'org',
        'owner',
        { equipmentIds: [] },
        'visit',
      ),
    ).rejects.toThrow('RVT_VISIT_EQUIPMENT_REQUIRED');
  });

  it('scopes visit lookup to the organization and configuration', async () => {
    const { tx, repository } = scenario();
    await repository.manageOccurrence('config', 'org', 'owner', {}, 'visit');
    expect(tx.rvtOccurrence.findFirstOrThrow).toHaveBeenCalledWith({
      where: {
        id: 'visit',
        configurationId: 'config',
        organizationId: 'org',
        deletedAt: null,
      },
      include: { execution: true },
    });
  });
});

describe('RVT execution authority', () => {
  const setup = (eligible = true) => {
    const repository = {
      occurrence: jest.fn().mockResolvedValue({
        ...current,
        businessUnitId: 'unit',
        configuration,
      }),
      canExecute: jest.fn().mockResolvedValue(eligible),
      startExecution: jest.fn().mockResolvedValue({ id: 'execution' }),
      execution: jest.fn().mockResolvedValue({
        id: 'execution',
        businessUnitId: 'unit',
        responsibleFieldTechnicianId: 'tech',
        status: 'IN_PROGRESS',
        startedAt: new Date(),
      }),
      updateExecution: jest.fn(),
    };
    const service = new RvtService(
      repository as never,
      new RvtMapper(),
      {} as never,
      {} as never,
    );
    return { repository, service };
  };
  it('allows the assigned field technician to start', async () => {
    const { repository, service } = setup();
    await service.start('visit', actor, {});
    expect(repository.startExecution).toHaveBeenCalledWith(
      expect.objectContaining({ responsibleId: 'tech' }),
    );
  });
  it.each([false, true])(
    'only opens an assigned visit after approval when required (approved=%s)',
    async (approved) => {
      const { repository, service } = setup();
      repository.occurrence.mockResolvedValue({
        ...current,
        businessUnitId: 'unit',
        configuration,
        assignmentAuthorizationRequired: true,
        authorizedAt: approved ? new Date() : null,
      });
      if (approved) {
        await service.start('visit', actor, {});
        expect(repository.startExecution).toHaveBeenCalled();
      } else {
        await expect(service.start('visit', actor, {})).rejects.toThrow(
          /Visita RVT/,
        );
        await expect(service.preparation('visit', actor)).rejects.toThrow(
          /Visita RVT/,
        );
        expect(repository.startExecution).not.toHaveBeenCalled();
      }
    },
  );
  it('prevents reading or editing an unapproved execution directly', async () => {
    const { repository, service } = setup();
    repository.execution.mockResolvedValue({
      id: 'execution',
      businessUnitId: 'unit',
      assignmentAuthorizationRequired: true,
      occurrence: { authorizedAt: null },
    });
    await expect(service.execution('execution', actor)).rejects.toThrow(
      /Visita RVT/,
    );
    await expect(
      service.updateExecution('execution', actor, {}),
    ).rejects.toThrow(/Visita RVT/);
    expect(repository.updateExecution).not.toHaveBeenCalled();
  });
  it('rejects auxiliary execution even with a manually granted execute permission', async () => {
    const { repository, service } = setup(false);
    await expect(service.start('visit', actor, {})).rejects.toThrow(
      /Somente o proprietário/,
    );
    await expect(
      service.updateExecution('execution', actor, {}),
    ).rejects.toThrow(/Somente o proprietário/);
    expect(repository.startExecution).not.toHaveBeenCalled();
    expect(repository.updateExecution).not.toHaveBeenCalled();
  });
  it('allows an auxiliary to view the execution without publishing edit actions', async () => {
    const { repository, service } = setup(false);
    const result = await service.execution('execution', {
      ...actor,
      permissions: ['rvt.read'],
    });
    expect(result.allowedActions).toEqual(['VIEW']);
    expect(repository.updateExecution).not.toHaveBeenCalled();
  });
  it('does not let another field technician claim an assigned visit', async () => {
    const { repository, service } = setup();
    await expect(
      service.start(
        'visit',
        { ...actor, actorId: 'another' },
        { responsibleFieldTechnicianId: 'another' },
      ),
    ).rejects.toThrow(/atribuída a outro/);
    expect(repository.startExecution).not.toHaveBeenCalled();
  });
  it('allows the owner to execute as the actual field attendant', async () => {
    const { repository, service } = setup(false);
    await service.start(
      'visit',
      { ...actor, actorId: 'owner', isOrganizationOwner: true },
      {},
    );
    expect(repository.startExecution).toHaveBeenCalledWith(
      expect.objectContaining({ responsibleId: 'owner', actorId: 'owner' }),
    );
  });
  it('denies execution outside the actor business units', async () => {
    const { repository, service } = setup();
    await expect(
      service.start('visit', { ...actor, businessUnitIds: ['other'] }, {}),
    ).rejects.toThrow(/scope/);
    expect(repository.startExecution).not.toHaveBeenCalled();
  });
});

describe('RVT public inputs', () => {
  it('validates visit date, clock time and nonempty equipment selection', async () => {
    const dto = plainToInstance(CreateRvtOccurrenceDto, {
      scheduledDate: 'wrong',
      startTime: '25:10',
      equipmentIds: [],
    });
    const errors = await validate(dto);
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['scheduledDate', 'startTime', 'equipmentIds']),
    );
  });
  it('does not permit changing a configuration customer in a PATCH', async () => {
    const dto = plainToInstance(UpdateRvtConfigurationDto, {
      customerId: 'other',
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    expect(errors.some((error) => error.property === 'customerId')).toBe(true);
  });
});

describe('RVT completed-visit timeline and reconciliation', () => {
  it('queries one completed execution per item for the same customer and unit', async () => {
    const { tx } = scenario();
    const executions = [
      { id: 'recent', responsibleFieldTechnicianId: 'tech' },
      { id: 'older', responsibleFieldTechnicianId: 'tech' },
    ];
    const rvtExecution = { findMany: jest.fn().mockResolvedValue(executions) };
    const user = {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'tech', displayName: 'Técnico' }]),
    };
    const repository = new RvtRepository({
      run: (callback: any) => callback({ ...tx, rvtExecution, user }),
    } as never);
    const result = await repository.timeline('config', 'org', { limit: 1 });
    expect(rvtExecution.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'org',
          businessUnitId: 'unit',
          status: 'COMPLETED',
          occurrence: { configuration: { customerId: 'customer' } },
        },
        take: 2,
      }),
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('recent');
    expect(result.nextCursor).toBe('recent');
    expect(result.hasNextPage).toBe(true);
  });

  it('preserves an individually moved visit without recreating its original date', async () => {
    const { tx } = scenario();
    const first = {
      ...current,
      id: 'first',
      sequenceNumber: 1,
      scheduledFor: new Date('2099-01-10T12:00:00Z'),
      localScheduledDate: new Date('2099-01-10'),
    };
    const findMany = jest
      .fn()
      .mockResolvedValueOnce([first])
      .mockResolvedValueOnce([
        {
          localScheduledDate: new Date('2099-02-12'),
          originalScheduledDate: new Date('2099-02-10'),
        },
      ]);
    const extended = {
      ...tx,
      rvtConfiguration: {
        ...tx.rvtConfiguration,
        findFirstOrThrow: jest.fn().mockResolvedValue({
          ...configuration,
          coverageStart: new Date('2099-01-10'),
          coverageEnd: new Date('2099-02-28'),
        }),
        update: jest.fn(),
      },
      rvtOccurrence: { ...tx.rvtOccurrence, findMany },
    };
    const repository = new RvtRepository({
      run: (callback: any) => callback(extended),
    } as never);
    const result = await repository.updateConfiguration(
      'config',
      'org',
      'owner',
      {},
      [
        {
          localDate: '2099-01-10',
          scheduledFor: first.scheduledFor,
          sequenceNumber: 1,
        },
        {
          localDate: '2099-02-10',
          scheduledFor: new Date('2099-02-10T12:00:00Z'),
          sequenceNumber: 2,
        },
      ],
    );
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          customized: false,
          deletedAt: null,
          execution: null,
          status: 'SCHEDULED',
        }),
      }),
    );
    expect(tx.rvtOccurrence.create).not.toHaveBeenCalled();
    expect(result).toEqual({ created: 0, cancelled: 0, rescheduled: 0 });
  });

  it('starts a visit with exactly its selected equipment instead of every contract equipment', async () => {
    const { tx } = scenario();
    tx.rvtOccurrence.findFirstOrThrow.mockResolvedValue({
      ...current,
      businessUnitId: 'unit',
      equipmentIds: ['asset2'],
      configuration: { ...configuration, procedure: {}, maintenanceType: null },
    } as any);
    const operation = {
      create: jest.fn().mockResolvedValue({ id: 'operation' }),
    };
    const operationAsset = { createMany: jest.fn() };
    const rvtExecution = {
      create: jest.fn().mockResolvedValue({ id: 'execution' }),
    };
    const asset = {
      ...tx.asset,
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'asset2', name: 'Equipamento 2' }]),
    };
    const repository = new RvtRepository({
      run: (callback: any) =>
        callback({ ...tx, operation, operationAsset, rvtExecution, asset }),
    } as never);
    await repository.startExecution({
      organizationId: 'org',
      occurrenceId: 'visit',
      actorId: 'tech',
      responsibleId: 'tech',
      auxiliaries: [],
    });
    expect(asset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['asset2'] },
          organizationId: 'org',
          businessUnitId: 'unit',
          customerId: 'customer',
          deletedAt: null,
        },
      }),
    );
    expect(operationAsset.createMany).toHaveBeenCalledWith({
      data: [{ operationId: 'operation', assetId: 'asset2' }],
    });
    expect(rvtExecution.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          equipment: {
            create: [expect.objectContaining({ assetId: 'asset2' })],
          },
        }),
      }),
    );
  });
});

describe('RVT visit schedule patches', () => {
  it('preserves a customized time when only the date is changed', async () => {
    const repository = {
      occurrence: jest.fn().mockResolvedValue({
        ...current,
        scheduledFor: new Date('2027-01-10T17:35:00Z'),
      }),
      manageOccurrence: jest.fn(),
    };
    const service = new RvtService(
      repository as never,
      new RvtMapper(),
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({
      timezone: 'America/Recife',
      startTime: '09:00',
    } as never);
    await service.manageOccurrence(
      'config',
      actor,
      { scheduledDate: '2027-01-12' },
      'visit',
    );
    expect(repository.manageOccurrence).toHaveBeenCalledWith(
      'config',
      'org',
      'tech',
      expect.objectContaining({
        scheduledFor: new Date('2027-01-12T17:35:00Z'),
      }),
      'visit',
      false,
    );
  });
  it('refuses a visit belonging to a different configuration before applying changes', async () => {
    const repository = {
      occurrence: jest
        .fn()
        .mockResolvedValue({ ...current, configurationId: 'another' }),
      manageOccurrence: jest.fn(),
    };
    const service = new RvtService(
      repository as never,
      new RvtMapper(),
      {} as never,
      {} as never,
    );
    jest.spyOn(service, 'get').mockResolvedValue({
      timezone: 'America/Recife',
      startTime: '09:00',
    } as never);
    await expect(
      service.manageOccurrence(
        'config',
        actor,
        { scheduledDate: '2027-01-12' },
        'visit',
      ),
    ).rejects.toThrow();
    expect(repository.manageOccurrence).not.toHaveBeenCalled();
  });
});
