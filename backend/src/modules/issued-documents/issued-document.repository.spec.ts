import { IssuedDocumentRepository } from './issued-document.repository';
import { IssuedDocumentQueryDto } from './issued-document.dto';

/**
 * Um fragmento de SQL do Prisma, reconhecido pela forma.
 *
 * `Prisma.Sql` não é construtor em tempo de execução nesta versão — `instanceof`
 * contra ele lança. O que o fragmento tem é `strings`, `values` e o texto pronto,
 * e é por isso que se reconhece.
 */
interface SqlFragment {
  readonly text: string;
  readonly values: readonly unknown[];
}

const isSql = (value: unknown): value is SqlFragment =>
  typeof value === 'object' &&
  value !== null &&
  'strings' in value &&
  'values' in value &&
  typeof (value as { text?: unknown }).text === 'string';

/**
 * A união das duas origens, e os filtros sobre ela.
 *
 * ## Por que o teste lê o SQL
 *
 * Porque é o SQL que decide. A união não passa por nenhuma camada de domínio: um
 * ramo esquecido, um filtro aplicado no lugar errado ou uma ordenação instável são
 * defeitos que só existem no texto da consulta — e um teste de serviço com
 * repositório dublado não veria nenhum dos três.
 *
 * O dublê captura o que foi montado: as partes estáticas da consulta e cada
 * fragmento interpolado, que é um `Prisma.Sql` com o próprio texto dentro.
 */
describe('IssuedDocumentRepository', () => {
  const consultar = async (patch: Partial<IssuedDocumentQueryDto> = {}) => {
    const captura: {
      strings: string[];
      fragments: string[];
      values: unknown[];
    } = { strings: [], fragments: [], values: [] };

    const tx = {
      $queryRaw: jest.fn((strings: string[], ...values: unknown[]) => {
        captura.strings = [...strings];
        captura.values = values;
        captura.fragments = values.map((value) =>
          isSql(value) ? value.text : String(value),
        );
        return Promise.resolve([]);
      }),
    };
    const rls = { run: (work: (client: typeof tx) => unknown) => work(tx) };
    const repository = new IssuedDocumentRepository(rls as never);

    const query = Object.assign(new IssuedDocumentQueryDto(), patch);
    const resultado = await repository.page('org-id', query);

    /* O texto inteiro, para perguntar "este ramo entrou?" sem depender de em qual
       posição ele caiu. */
    const sql = captura.strings
      .map((parte, indice) => parte + (captura.fragments[indice] ?? ''))
      .join('');

    return { sql, captura, resultado };
  };

  describe('os dois ramos', () => {
    it('sem recorte de origem, une execuções e relatórios', async () => {
      const { sql } = await consultar();
      expect(sql).toContain('artifact_executions');
      expect(sql).toContain('management_reports');
      expect(sql).toContain('UNION ALL');
    });

    /**
     * Pedindo uma origem, a outra não é consultada.
     *
     * Não é otimização: um ramo filtrado para vazio dentro de `UNION ALL` ainda
     * varre a tabela dele.
     */
    it('só execuções: a tabela de relatórios não é tocada', async () => {
      const { sql } = await consultar({ source: 'EXECUTION' });
      expect(sql).toContain('artifact_executions');
      expect(sql).not.toContain('management_reports');
      expect(sql).not.toContain('UNION ALL');
    });

    it('só relatórios: a tabela de execuções não é tocada', async () => {
      const { sql } = await consultar({ source: 'REPORT' });
      expect(sql).toContain('management_reports');
      expect(sql).not.toContain('artifact_executions');
      expect(sql).not.toContain('UNION ALL');
    });
  });

  describe('os ramos que um filtro exclui', () => {
    /** `NOT_RENDERED` é estado só de execução: relatório sem arquivo não foi pedido. */
    it('a fila "sem documento" não consulta relatórios', async () => {
      const { sql } = await consultar({ renderStatus: 'NOT_RENDERED' });
      expect(sql).toContain('artifact_executions');
      expect(sql).not.toContain('management_reports');
    });

    /** As outras filas valem para os dois: ambos ficam na fila, compõem e falham. */
    it.each(['READY', 'RENDERING', 'PENDING', 'FAILED'])(
      'a fila %s consulta as duas origens',
      async (renderStatus) => {
        const { sql } = await consultar({ renderStatus });
        expect(sql).toContain('artifact_executions');
        expect(sql).toContain('management_reports');
      },
    );

    /**
     * Relatório gerencial não tem cliente nem atendimento.
     *
     * Ele retrata a operação inteira num intervalo. Filtrar por cliente exclui o
     * ramo por definição — e consultá-lo seria varrer a tabela para descartar tudo.
     */
    it('filtro por cliente não consulta relatórios', async () => {
      const { sql } = await consultar({
        customerId: '01900000-0000-7000-8000-000000000001',
      });
      expect(sql).not.toContain('management_reports');
    });

    it('filtro por atendimento não consulta relatórios', async () => {
      const { sql } = await consultar({
        operationId: '01900000-0000-7000-8000-000000000001',
      });
      expect(sql).not.toContain('management_reports');
    });
  });

  describe('os filtros comuns', () => {
    it('sem filtro, nenhuma condição além do inquilino', async () => {
      const { sql } = await consultar();
      expect(sql).not.toContain('business_unit_id = $');
      expect(sql).not.toContain('ILIKE');
    });

    it('a unidade recorta depois da união, uma vez só', async () => {
      const { sql } = await consultar({ businessUnitId: 'unidade' });
      expect(sql.match(/AND business_unit_id = /g)).toHaveLength(1);
    });

    it('o tipo recorta pela coluna unificada', async () => {
      const { sql } = await consultar({ artifactType: 'PMOC' });
      expect(sql).toContain('AND type = ');
    });

    it('a busca cobre código e título, sem diferenciar caixa', async () => {
      const { sql, captura } = await consultar({ search: 'ORC-42' });
      expect(sql).toContain('code ILIKE');
      expect(sql).toContain('title ILIKE');
      /* O termo viaja como valor com curingas, e não interpolado no texto: é o
         que impede que um `%` digitado pela pessoa vire parte da consulta. */
      const fragmento = captura.values.find(
        (value): value is SqlFragment =>
          isSql(value) && value.text.includes('ILIKE'),
      );
      expect(fragmento?.values).toContain('%ORC-42%');
    });

    /**
     * O fim do período é inclusivo.
     *
     * Quem filtra "até 31/03" espera o dia 31 inteiro, e uma data sem hora chega
     * como meia-noite: `<=` cru descartaria o dia todo.
     */
    it('o fim do período pega o dia inteiro', async () => {
      const { captura } = await consultar({ createdTo: '2026-03-31' });
      const fragmento = captura.values.find(
        (value): value is SqlFragment =>
          isSql(value) && value.text.includes('created_at <='),
      );
      const data = fragmento?.values[0] as Date;
      expect(data.toISOString()).toBe('2026-03-31T23:59:59.999Z');
    });

    /** Data com hora é respeitada como veio: quem a informou foi específico. */
    it('data com hora não é esticada', async () => {
      const { captura } = await consultar({
        createdTo: '2026-03-31T10:00:00.000Z',
      });
      const fragmento = captura.values.find(
        (value): value is SqlFragment =>
          isSql(value) && value.text.includes('created_at <='),
      );
      const data = fragmento?.values[0] as Date;
      expect(data.toISOString()).toBe('2026-03-31T10:00:00.000Z');
    });
  });

  describe('a página', () => {
    /**
     * A ordenação precisa de desempate.
     *
     * Sem o id, duas linhas do mesmo instante podem trocar de lugar entre
     * páginas — e uma delas nunca aparece em nenhuma das duas.
     */
    it('ordena por data e desempata pelo id', async () => {
      const { sql } = await consultar();
      expect(sql).toContain('ORDER BY created_at DESC, id DESC');
    });

    it('a contagem vem na mesma varredura', async () => {
      const { sql } = await consultar();
      expect(sql).toContain('COUNT(*) OVER () AS total');
    });

    it('o deslocamento é calculado a partir da página', async () => {
      const { captura } = await consultar({ page: 3, limit: 20 });
      expect(captura.values).toContain(40);
      expect(captura.values).toContain(20);
    });

    it('a primeira página não desloca nada', async () => {
      const { captura } = await consultar({ page: 1, limit: 20 });
      expect(captura.values).toContain(0);
    });

    /** Sem linha, o total é zero — e não `undefined` vindo de uma linha ausente. */
    it('lista vazia devolve total zero', async () => {
      const { resultado } = await consultar();
      expect(resultado).toEqual({ data: [], total: 0 });
    });
  });
});
