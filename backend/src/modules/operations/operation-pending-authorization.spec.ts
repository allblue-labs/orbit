/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
import { OperationRepository } from './operation.repository';
import { OperationQueryDto } from './dto/operation.dto';

/**
 * O recorte da fila de autorização, e a convivência dos filtros.
 *
 * ## Por que o teste lê o `where`
 *
 * Porque é o `where` que decide. O filtro de pendência e o de técnico são duas
 * condições sobre a mesma consulta, e foi exatamente aí que estava um defeito: a
 * atribuição e a busca escreviam a mesma chave `OR` no mesmo objeto, e a segunda
 * apagava a primeira. Pedir "os de Eduardo" **e** um termo devolvia qualquer
 * atendimento que combinasse com o termo, de quem fosse — silenciosamente.
 */
describe('o recorte da fila de autorização', () => {
  const consultar = async (patch: Partial<OperationQueryDto> = {}) => {
    const tx = {
      operation: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new OperationRepository(rls as never, {} as never);
    await repository.list('org', Object.assign(new OperationQueryDto(), patch));
    const [[consulta]] = tx.operation.findMany.mock.calls;
    return consulta.where as Record<string, unknown> & { AND?: unknown[] };
  };

  it('a fila pede o que está atribuído e sem carimbo', async () => {
    const where = await consultar({ pendingAuthorization: true });
    expect(where.authorizedAt).toBeNull();
    expect(where.responsibleFieldTechnicianId).toEqual({ not: null });
  });

  /** Sem o filtro, a listagem comum não deve ganhar recorte nenhum de autorização. */
  it('sem o filtro, nada de autorização entra na consulta', async () => {
    const where = await consultar({});
    expect(where.authorizedAt).toBeUndefined();
    expect(where.responsibleFieldTechnicianId).toBeUndefined();
  });

  /** A contagem é do conjunto filtrado, não da página: é o mesmo `where`. */
  it('a contagem usa o mesmo recorte da página', async () => {
    const tx = {
      operation: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new OperationRepository(rls as never, {} as never);
    await repository.list(
      'org',
      Object.assign(new OperationQueryDto(), { pendingAuthorization: true }),
    );
    const [[pagina]] = tx.operation.findMany.mock.calls;
    const [[contagem]] = tx.operation.count.mock.calls;
    expect(contagem.where).toBe(pagina.where);
  });

  describe('os filtros convivem', () => {
    /**
     * O defeito: a busca apagava o filtro de técnico.
     *
     * Dentro de `AND` cada um continua sendo um `OR` próprio, e as duas condições são
     * exigidas.
     */
    it('técnico e busca valem os dois', async () => {
      const where = await consultar({
        assignedUserId: '01900000-0000-7000-8000-000000000001',
        search: 'ar condicionado',
      });

      const [porTecnico, porBusca] = where.AND as [
        { OR: Record<string, unknown>[] },
        { OR: Record<string, unknown>[] },
      ];
      expect(where.AND).toHaveLength(2);
      expect(porTecnico.OR[0]).toEqual({
        responsibleFieldTechnicianId: '01900000-0000-7000-8000-000000000001',
      });
      expect(
        porBusca.OR.map(
          (item: Record<string, unknown>) => Object.keys(item)[0],
        ),
      ).toEqual(['code', 'title', 'description']);
    });

    it('só o técnico produz uma condição', async () => {
      const where = await consultar({
        assignedUserId: '01900000-0000-7000-8000-000000000001',
      });
      expect(where.AND).toHaveLength(1);
    });

    it('sem nenhum dos dois, nenhuma condição', async () => {
      const where = await consultar({});
      expect(where.AND).toEqual([]);
    });

    /** A fila filtrada por técnico é o caso da tela: os dois recortes juntos. */
    it('pendência e técnico valem os dois', async () => {
      const where = await consultar({
        pendingAuthorization: true,
        assignedUserId: '01900000-0000-7000-8000-000000000001',
      });
      expect(where.authorizedAt).toBeNull();
      expect(where.AND).toHaveLength(1);
    });

    /** O técnico conta como atribuído também quando é auxiliar. */
    it('o recorte por técnico alcança responsável e auxiliar', async () => {
      const where = await consultar({
        assignedUserId: '01900000-0000-7000-8000-000000000001',
      });
      const [porTecnico] = where.AND as [{ OR: Record<string, unknown>[] }];
      const chaves = porTecnico.OR.map((item) => Object.keys(item)[0]);
      expect(chaves).toContain('responsibleFieldTechnicianId');
      expect(chaves).toContain('auxiliaryTechnicians');
    });
  });
});
