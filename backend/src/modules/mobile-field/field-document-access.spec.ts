import type { MobileFieldActor } from './mobile-field.service';
import {
  fieldDocumentAccess,
  fieldOperationAssignment,
} from './field-document-access';
import { MobileFieldRepository } from './mobile-field.repository';
import { MobileFieldArtifactRepository } from './mobile-field-artifact.repository';

const actor: MobileFieldActor = {
  id: 'user-A',
  organizationId: 'org-A',
  businessUnitIds: ['unit-A'],
  permissions: ['artifact_executions.read', 'operations.read'],
};

describe('isolamento de documentos de campo', () => {
  function setup() {
    const findMany = jest
      .fn<Promise<unknown[]>, [unknown]>()
      .mockResolvedValue([]);
    const findFirst = jest
      .fn<Promise<null>, [unknown]>()
      .mockResolvedValue(null);
    const tx = { fieldArtifact: { findMany, findFirst } };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    return {
      tx,
      repository: new MobileFieldRepository(rls as never),
      artifacts: new MobileFieldArtifactRepository(rls as never),
    };
  }

  it('filtra documentos recentes por tenant, unidades e vínculo individual', async () => {
    const { repository, tx } = setup();
    await repository.recentDocuments(
      actor.organizationId,
      actor.businessUnitIds,
      5,
      actor,
    );
    expect(tx.fieldArtifact.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizationId: 'org-A',
        businessUnitId: { in: ['unit-A'] },
        ...fieldDocumentAccess(actor),
      },
      take: 5,
    });
    expect(fieldOperationAssignment(actor)).toEqual({
      OR: [
        { responsibleFieldTechnicianId: 'user-A' },
        {
          auxiliaryTechnicians: { some: { userId: 'user-A', removedAt: null } },
        },
      ],
    });
  });

  it('a busca por cliente ou título não substitui o filtro individual', async () => {
    const { repository, tx } = setup();
    await repository.documentsPage(
      'org-A',
      ['unit-A'],
      { take: 21, search: 'Cliente', customerId: 'customer-A' },
      actor,
    );
    expect(tx.fieldArtifact.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: {
        organizationId: 'org-A',
        businessUnitId: { in: ['unit-A'] },
        AND: [fieldDocumentAccess(actor)],
        artifactExecution: { customerId: 'customer-A' },
      },
    });
  });

  it('abrir diretamente por ID exige o mesmo vínculo da listagem', async () => {
    const { artifacts, tx } = setup();
    expect(await artifacts.get(actor, 'artifact-B')).toBeNull();
    expect(tx.fieldArtifact.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        id: 'artifact-B',
        organizationId: 'org-A',
        businessUnitId: { in: ['unit-A'] },
        ...fieldDocumentAccess(actor),
      },
    });
  });

  it('buscar documento existente pela fonte também exige vínculo individual', async () => {
    const { artifacts, tx } = setup();
    await artifacts.existing(actor, 'OPERATION', 'operation-B');
    expect(tx.fieldArtifact.findFirst.mock.calls[0]?.[0]).toMatchObject({
      where: {
        sourceType: 'OPERATION',
        sourceId: 'operation-B',
        ...fieldDocumentAccess(actor),
      },
    });
  });

  it('dois usuários da mesma unidade recebem filtros diferentes', () => {
    const other = { ...actor, id: 'user-B' };
    expect(JSON.stringify(fieldDocumentAccess(actor))).not.toContain('user-B');
    expect(JSON.stringify(fieldDocumentAccess(other))).not.toContain('user-A');
    expect(fieldDocumentAccess(actor)).not.toEqual(fieldDocumentAccess(other));
  });

  it.each([
    { ...actor, isOrganizationOwner: true, permissions: [] },
    { ...actor, permissions: ['*'] },
    { ...actor, permissions: ['operations.manage'] },
  ])(
    'gestão mantém acesso documental somente dentro de seu tenant e unidades',
    async (manager) => {
      const { artifacts, tx } = setup();
      await artifacts.get(manager, 'artifact-A');
      expect(fieldDocumentAccess(manager)).toEqual({});
      expect(tx.fieldArtifact.findFirst.mock.calls[0]?.[0]).toMatchObject({
        where: {
          id: 'artifact-A',
          organizationId: 'org-A',
          businessUnitId: { in: ['unit-A'] },
        },
      });
    },
  );

  it('nenhuma unidade autorizada resulta em nenhuma consulta documental', async () => {
    const { repository, tx } = setup();
    expect(
      await repository.documentsPage('org-A', [], { take: 21 }, actor),
    ).toEqual([]);
    expect(tx.fieldArtifact.findMany).not.toHaveBeenCalled();
  });
});
