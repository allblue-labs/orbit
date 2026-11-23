import { JOB_QUEUES } from './background-job.types';
import {
  assertQueueGroups,
  backoffDelay,
  buildQueueGroups,
  envInt,
  groupOf,
  QUEUE_GROUPS,
} from './queue-groups';

describe('grupos de filas', () => {
  it('toda fila conhecida pertence a exatamente um grupo', () => {
    expect(() => assertQueueGroups(QUEUE_GROUPS)).not.toThrow();
    for (const queue of Object.values(JOB_QUEUES))
      expect(groupOf(queue).queues).toContain(queue);
  });

  it('recusa fila sem grupo, em dois grupos ou com prefixo alheio', () => {
    expect(() =>
      assertQueueGroups(QUEUE_GROUPS, [
        ...Object.values(JOB_QUEUES),
        'nova.fila',
      ]),
    ).toThrow('sem grupo');

    const duplicada = buildQueueGroups({});
    expect(() =>
      assertQueueGroups({
        ...duplicada,
        comms: {
          ...duplicada.comms,
          queues: [...duplicada.comms.queues, JOB_QUEUES.artifactRender],
        },
      }),
    ).toThrow('dois grupos');

    expect(() =>
      assertQueueGroups(
        {
          ...duplicada,
          core: {
            ...duplicada.core,
            queues: [...duplicada.core.queues, 'fiscal.nfe.emit' as never],
          },
        },
        [...Object.values(JOB_QUEUES), 'fiscal.nfe.emit'],
      ),
    ).toThrow('prefixo de fiscal');
  });

  it('PDF roda em thread, no container documents, com 120 s e 2 por organização', () => {
    const pdf = groupOf(JOB_QUEUES.documentExport);
    expect(pdf).toMatchObject({
      name: 'pdf',
      role: 'documents',
      isolation: 'thread',
      timeoutMs: 120_000,
      perOrganizationLimit: 2,
    });
    expect(groupOf(JOB_QUEUES.managementReport).name).toBe('pdf');
    expect(groupOf(JOB_QUEUES.artifactRender).name).toBe('pdf');
  });

  it('fiscal repete de 1 min a 6 h com idempotência permanente; ai tem limite de taxa', () => {
    const { fiscal, ai } = buildQueueGroups({});
    expect(fiscal.idempotency).toBe('permanent');
    expect(backoffDelay(1, fiscal.backoff)).toBe(60_000);
    expect(backoffDelay(2, fiscal.backoff)).toBe(120_000);
    expect(backoffDelay(12, fiscal.backoff)).toBe(6 * 3_600_000);
    expect(ai.rateLimit).toEqual({
      perOrganization: { max: 10, windowMs: 60_000 },
      global: { max: 60, windowMs: 60_000 },
    });
  });

  it('lê o ambiente dentro de limites e cai no padrão quando inválido', () => {
    expect(envInt('X', 2, { max: 8 }, { X: '4' })).toBe(4);
    expect(envInt('X', 2, { max: 8 }, { X: '0' })).toBe(2);
    expect(envInt('X', 2, { max: 8 }, { X: '99' })).toBe(2);
    expect(envInt('X', 2, { max: 8 }, { X: '1.5' })).toBe(2);
    expect(envInt('X', 2, { max: 8 }, { X: 'abc' })).toBe(2);
    expect(
      buildQueueGroups({ JOBS_PDF_PER_ORG: '3' }).pdf.perOrganizationLimit,
    ).toBe(3);
  });
});
