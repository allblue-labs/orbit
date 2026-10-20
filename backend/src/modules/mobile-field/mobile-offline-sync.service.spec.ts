import { generateUuidV7 } from '../../utils';
import { MobileOfflineSyncService } from './mobile-offline-sync.service';
import type { MobileFieldActor } from './mobile-field.service';

describe('MobileOfflineSyncService', () => {
  const actor: MobileFieldActor = {
    id: generateUuidV7(),
    organizationId: generateUuidV7(),
    businessUnitIds: [generateUuidV7()],
    permissions: ['*'],
  };
  const repository = {
    operationScopes: jest.fn().mockResolvedValue([]),
    currentPermissions: jest.fn().mockResolvedValue(['*']),
    pmocPackage: jest.fn(),
    rvtPackage: jest.fn(),
    journalBounds: jest.fn().mockResolvedValue({ oldest: null, latest: null }),
    journal: jest.fn().mockResolvedValue([]),
    findReceipt: jest.fn().mockResolvedValue(null),
    persistApplied: jest.fn(),
  };
  const field = { offlineItems: jest.fn(), fieldContext: jest.fn() };
  const operations = {
    preparation: jest.fn(),
    start: jest.fn(),
    complete: jest.fn(),
    addNote: jest.fn(),
    updateChecklist: jest.fn(),
    registerMaterial: jest.fn(),
  };
  const signatures = { acknowledge: jest.fn() };
  const jobs = { enqueue: jest.fn().mockResolvedValue({}) };
  const service = new MobileOfflineSyncService(
    repository as never,
    field as never,
    operations as never,
    signatures as never,
    jobs as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['PMOC', 'PMOC'],
    ['RVT', 'RVT'],
  ] as const)(
    'builds a bounded %s package without inventing another domain model',
    async (kind, expected) => {
      const sourceId = generateUuidV7();
      const workItem = {
        id: `${kind}:${sourceId}`,
        kind,
        sourceId,
        businessUnit: { id: actor.businessUnitIds[0], name: 'Unidade' },
        allowedActions: [kind === 'PMOC' ? 'EXECUTE_PMOC' : 'EXECUTE_RVT'],
        updatedAt: new Date().toISOString(),
        navigationContext: { executionId: generateUuidV7() },
      };
      field.offlineItems.mockResolvedValue([workItem]);
      field.fieldContext.mockResolvedValue({
        workItem,
        request: { description: null },
        procedures: [],
        documentContext: [],
        snapshotVersion: 1,
      });
      repository.pmocPackage.mockResolvedValue(
        kind === 'PMOC'
          ? {
              id: sourceId,
              status: 'PENDING',
              dueOn: new Date(),
              updatedAt: new Date(),
              plan: { procedure: {}, technicalResponsibleUserId: null },
              equipmentExecutions: [],
            }
          : null,
      );
      repository.rvtPackage.mockResolvedValue(
        kind === 'RVT'
          ? {
              id: sourceId,
              status: 'SCHEDULED',
              scheduledFor: new Date(),
              updatedAt: new Date(),
              configuration: {
                procedure: {},
                requiresTechnicalResponsible: false,
                technicalResponsibleUserId: null,
              },
              execution: null,
            }
          : null,
      );
      const value = await service.package(actor, workItem.id);
      expect(value.kind).toBe(expected);
      expect(value.operation).toBeNull();
      expect(value.versionTokens).toMatchObject({
        workItem: workItem.updatedAt,
        execution: workItem.updatedAt,
      });
      expect(value.cachePolicy.authoritative).toBe(false);
      expect(value.mediaPolicy.blobsIncluded).toBe(false);
    },
  );

  it('does not expose journal ids that were never visible to the actor', async () => {
    field.offlineItems.mockResolvedValue([]);
    repository.journalBounds.mockResolvedValue({
      oldest: { sequence: 1n },
      latest: { sequence: 2n },
    });
    repository.journal.mockResolvedValue([
      {
        sequence: 2n,
        resourceType: 'WORK_ITEM',
        resourceId: 'secret',
        resourceVersion: 'v2',
      },
    ]);
    const cursor = Buffer.from(
      JSON.stringify({ v: 1, sequence: '1' }),
    ).toString('base64url');
    const value = await service.pull(actor, cursor, []);
    expect(value.changes).toEqual([]);
  });

  it('requires a full resync when the cursor row has been compacted', async () => {
    field.offlineItems.mockResolvedValue([]);
    repository.journalBounds.mockResolvedValue({
      oldest: { sequence: 3n },
      latest: { sequence: 8n },
    });
    const cursor = Buffer.from(
      JSON.stringify({ v: 1, sequence: '1' }),
    ).toString('base64url');

    const value = await service.pull(actor, cursor, []);

    expect(value).toMatchObject({
      status: 'FULL_RESYNC_REQUIRED',
      changes: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(repository.journal).not.toHaveBeenCalled();
  });

  it('pages an initial snapshot beyond 500 without skipping eligible work', async () => {
    const items = Array.from({ length: 601 }, (_, index) => ({
      id: `SERVICE_OPERATION:${String(index).padStart(4, '0')}`,
      updatedAt: `2026-09-11T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
    }));
    field.offlineItems.mockResolvedValue(items);
    repository.journalBounds.mockResolvedValue({
      oldest: { sequence: 1n },
      latest: { sequence: 41n },
    });

    const first = await service.pull(actor);
    expect(first.changes).toHaveLength(500);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.pull(actor, first.nextCursor!);
    expect(second.changes).toHaveLength(101);
    expect(second.changes[0]?.resourceId).toBe('SERVICE_OPERATION:0500');
    expect(second.hasMore).toBe(false);
    expect(
      JSON.parse(Buffer.from(second.nextCursor!, 'base64url').toString('utf8')),
    ).toEqual({ v: 1, sequence: '41' });
  });
});
