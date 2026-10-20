import { PmocMapper } from './pmoc.mapper';

describe('PMOC V2 public mapping', () => {
  const mapper = new PmocMapper();

  it('publishes cycle sequence without exposing persistence fields', () => {
    const result = mapper.execution({
      id: 'cycle',
      sequenceNumber: 3,
      dueOn: new Date('2026-09-01T00:00:00Z'),
      status: 'PENDING',
      performedAt: null,
      notes: null,
      schedulingEventId: null,
      createdAt: new Date('2026-08-01T00:00:00Z'),
      completedBy: null,
      operation: null,
      artifactExecution: null,
    });
    expect(result).toMatchObject({
      id: 'cycle',
      sequenceNumber: 3,
      dueOn: '2026-09-01',
    });
  });

  it('maps one physical execution and serializes file size safely', () => {
    const result = mapper.equipmentExecution({
      id: 'physical',
      status: 'IN_PROGRESS',
      /* A contagem é **do equipamento**, não do ciclo: o ciclo acima é o 3, e
         esta é a primeira manutenção deste aparelho no plano. */
      sequenceNumber: 1,
      performedAt: null,
      startedAt: new Date('2026-08-27T10:00:00Z'),
      completedAt: null,
      notes: null,
      procedureSnapshot: {},
      technicalResponsibleSnapshot: {},
      asset: {
        id: 'asset',
        name: 'Split 01',
        category: 'HVAC',
        identifier: 'QR-1',
        serialNumber: null,
      },
      responsibleFieldTechnician: { id: 'tech', displayName: 'Técnico' },
      operation: {
        id: 'operation',
        code: 'OS-1',
        status: 'IN_PROGRESS',
        auxiliaryTechnicians: [],
      },
      artifactExecution: null,
      evidence: [
        {
          id: 'evidence',
          kind: 'PHOTO',
          caption: null,
          createdAt: new Date('2026-08-27T10:01:00Z'),
          storageFile: {
            id: 'file',
            fileName: 'foto.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 42n,
            status: 'AVAILABLE',
          },
        },
      ],
    });
    expect(result.evidence[0]?.file.sizeBytes).toBe('42');
    expect(result.auxiliaryTechnicians).toEqual([]);
    /* A contagem publicada é a do equipamento. Se o mapeador pegasse a do ciclo,
       este número seria 3 — e o relatório afirmaria a terceira manutenção de uma
       máquina que está na primeira. */
    expect(result.sequenceNumber).toBe(1);
  });
});
