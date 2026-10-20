/**
 * O número da Ordem de Serviço.
 *
 * ## Por que a OS tem contagem própria
 *
 * Operação é o gênero. O PMOC executa criando operação, a RVT também, e um
 * orçamento aprovado vira operação. OS é uma **espécie** — e é o número dela que
 * o cliente cita ao telefone e que a nota fiscal referencia.
 *
 * Antes disto, o documento imprimia `OS-<code>`, onde `code` é o texto que o dono
 * digita ao criar a operação. O número da OS dependia da convenção de quem
 * digitou, e não existia contagem nenhuma: duas ordens podiam sair com códigos em
 * formatos diferentes, e não havia como dizer "esta é a 87ª ordem do ano".
 *
 * ## Por que uma função, e não um método do repositório
 *
 * Porque três caminhos criam ordem de serviço — a criação direta, a conversão de
 * uma solicitação do cliente e a conversão de um orçamento — e dois deles montam a
 * operação dentro das suas próprias transações. Uma função que recebe a transação
 * serve aos três sem que nenhum precise de um repositório que não é o seu.
 *
 * O que **não** chama esta função é o PMOC e a RVT: as operações deles têm as
 * contagens próprias, e consumir a da OS abriria buracos numa sequência que o
 * cliente lê como "quantas ordens eu já tive".
 */

/** O mínimo que a alocação precisa de um cliente Prisma. */
export interface ServiceOrderNumberClient {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
}

/**
 * Reserva o próximo número para esta organização.
 *
 * `ON CONFLICT DO UPDATE ... RETURNING` incrementa e devolve numa ida só, dentro
 * da transação de quem chama: duas criações simultâneas são serializadas pelo
 * próprio `UPDATE`, e nenhuma das duas vê o número da outra. Ler `MAX(...) + 1` na
 * aplicação faria as duas lerem o mesmo máximo — e a segunda quebraria no índice
 * único, que é a autoridade final contra duplicidade.
 *
 * Números não são devolvidos: uma transação que falha depois de reservar deixa um
 * buraco na sequência. É o preço certo — reaproveitar um número faria dois
 * documentos diferentes com a mesma identidade, e é o documento que o cliente
 * guarda.
 */
export async function allocateServiceOrderNumber(
  client: ServiceOrderNumberClient,
  organizationId: string,
): Promise<number> {
  const rows = await client.$queryRaw<{ last_value: number }[]>`
    INSERT INTO service_order_sequences (organization_id, last_value, updated_at)
    VALUES (${organizationId}::uuid, 1, now())
    ON CONFLICT (organization_id) DO UPDATE
      SET last_value = service_order_sequences.last_value + 1,
          updated_at = now()
    RETURNING last_value
  `;
  const value = rows[0]?.last_value;

  /*
   * O `RETURNING` sempre traz linha — `INSERT ... ON CONFLICT DO UPDATE` devolve a
   * que inseriu ou a que atualizou. Cair aqui significa que a consulta não é mais
   * a que este código pensa que é, e seguir com `1` gravaria um número já usado.
   */
  if (typeof value !== 'number') {
    throw new Error(
      'service_order_sequences did not return the allocated number',
    );
  }
  return value;
}

/**
 * O número como ele aparece no documento e na tela: `OS-000087`.
 *
 * Seis dígitos porque a OS é lida em voz alta e comparada em lista: largura fixa
 * ordena alfabeticamente igual a numericamente, e é o que faz `OS-000087` e
 * `OS-000112` se alinharem numa coluna. Acima de um milhão de ordens o número
 * cresce em vez de ser truncado — perder o dígito seria perder a identidade.
 */
export function formatServiceOrderNumber(value: number | null): string | null {
  return value === null ? null : `OS-${String(value).padStart(6, '0')}`;
}
