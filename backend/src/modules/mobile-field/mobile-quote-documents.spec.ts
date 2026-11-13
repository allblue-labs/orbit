import {
  MobileFieldService,
  type MobileFieldActor,
} from './mobile-field.service';
import {
  ASSIGNABLE_TEAM_ROLES,
  MOBILE_QUOTE_DOCUMENTS_PERMISSION as permission,
} from '../organizations/team-roles';

const actor: MobileFieldActor = {
  id: 'user',
  organizationId: 'tenant',
  businessUnitIds: ['unit'],
  permissions: ['artifact_executions.read'],
};
const id = (value: number) =>
  `01900000-0000-7000-8000-${String(value).padStart(12, '0')}`;
const customer = { tradeName: null, legalName: 'Cliente' };
const at = (day: number) =>
  new Date(`2026-11-${String(day).padStart(2, '0')}T12:00:00Z`);
function setup() {
  const fields = [3, 1].map((day) => ({
    id: id(day),
    documentType: 'SERVICE_ORDER',
    createdAt: at(day),
    artifactExecution: { renderStatus: 'READY', customer },
  }));
  const quotes = [4, 2].map((day) => ({
    id: id(day),
    code: `ORC-${day}`,
    createdAt: at(day),
    customer,
  }));
  const page = <T extends { id: string }>(
    rows: T[],
    options: { take: number; cursorId?: string },
  ) =>
    rows
      .slice(
        options.cursorId
          ? rows.findIndex((row) => row.id === options.cursorId) + 1
          : 0,
      )
      .slice(0, options.take);
  const repository = {
    documentsPage: jest.fn(
      (
        _org: string,
        _units: readonly string[],
        options: { take: number; cursorId?: string },
      ) => Promise.resolve(page(fields, options)),
    ),
    quoteDocumentsPage: jest.fn(
      (
        _org: string,
        _units: readonly string[],
        options: { take: number; cursorId?: string },
      ) => Promise.resolve(page(quotes, options)),
    ),
  };
  return { repository, service: new MobileFieldService(repository as never) };
}

describe('orçamentos na lista de documentos mobile', () => {
  it('nenhum papel padrão recebe a permissão; gestão operacional não a substitui', async () => {
    expect(
      ASSIGNABLE_TEAM_ROLES.every(
        (role) => !role.permissions.includes(permission),
      ),
    ).toBe(true);
    const { service, repository } = setup();
    await service.documents(
      { ...actor, permissions: ['operations.manage', 'quotes.manage'] },
      {},
    );
    expect(repository.quoteDocumentsPage).not.toHaveBeenCalled();
    await expect(service.documents(actor, { type: 'QUOTE' })).rejects.toThrow();
  });
  it('owner e operador liberado recebem somente orçamentos quando filtrados', async () => {
    for (const reader of [
      { ...actor, isOrganizationOwner: true },
      { ...actor, permissions: [permission] },
    ]) {
      const { service, repository } = setup();
      const result = await service.documents(reader, {
        type: 'QUOTE',
        search: 'Cliente',
        customerId: 'customer',
      });
      expect(result.data.map((row) => row.label)).toEqual([
        'Orçamento ORC-4',
        'Orçamento ORC-2',
      ]);
      expect(repository.documentsPage).not.toHaveBeenCalled();
      expect(repository.quoteDocumentsPage).toHaveBeenCalledWith(
        'tenant',
        ['unit'],
        expect.objectContaining({ search: 'Cliente', customerId: 'customer' }),
      );
    }
  });
  it('pagina fontes intercaladas sem perder nem repetir registros', async () => {
    const { service } = setup();
    const reader = { ...actor, isOrganizationOwner: true };
    let cursor: string | undefined;
    const collected: string[] = [];
    for (let page = 0; page < 4; page++) {
      const result = await service.documents(reader, { limit: 1, cursor });
      expect(result.data).toHaveLength(1);
      collected.push(result.data[0]!.artifactId);
      expect(result.meta.hasNextPage).toBe(page < 3);
      cursor = result.meta.nextCursor ?? undefined;
    }
    expect(collected).toEqual([4, 3, 2, 1].map(id));
  });
  it('cursor adulterado é recusado antes de consultar qualquer fonte', async () => {
    const { service, repository } = setup();
    for (const payload of [
      { v: 2, quoteId: 'not-a-uuid' },
      { v: 2, quoteId: '-'.repeat(36) },
      { v: 1, id: '-'.repeat(36) },
    ]) {
      const cursor = Buffer.from(JSON.stringify(payload)).toString('base64url');
      await expect(
        service.documents({ ...actor, isOrganizationOwner: true }, { cursor }),
      ).rejects.toThrow();
    }
    expect(repository.documentsPage).not.toHaveBeenCalled();
    expect(repository.quoteDocumentsPage).not.toHaveBeenCalled();
  });
});
