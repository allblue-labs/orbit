/**
 * O código do item de catálogo — o SKU.
 *
 * ## O que estava errado
 *
 * O campo era opcional e ninguém o preenchia: todo item nascia sem código. O
 * catálogo é a fonte de produtos, serviços e peças para orçamento, estoque e
 * ordem de serviço, e o SKU é como as pessoas se referem a um item quando não
 * estão olhando a tela — no telefone com o fornecedor, na conferência do almoxarifado,
 * na conversa sobre o que foi aplicado num atendimento. Sem ele, cada conversa
 * dessas dependia de dizer o nome inteiro e esperar que fosse o mesmo item.
 *
 * ## Uma contagem por fluxo, e não uma só
 *
 * Produto, serviço e peça são catálogos diferentes que moram na mesma tabela,
 * separados por `kind`. Uma sequência única faria o primeiro serviço da
 * organização nascer como o número 47 porque existem 46 produtos — e ninguém
 * consegue explicar isso para quem está montando a lista de serviços.
 *
 * Cada fluxo tem prefixo próprio e contagem própria: `PRD-000001` é o primeiro
 * produto, `SRV-000001` é o primeiro serviço, e os dois convivem.
 */

/**
 * O prefixo de cada fluxo.
 *
 * Em português porque o resto dos códigos do produto é: OS, PMOC, RVT, ORC. Um
 * `PRT` no meio de `PEC` seria a única sigla que exige tradução.
 */
const PREFIXES: Readonly<Record<string, string>> = {
  PRODUCT: 'PRD',
  SERVICE: 'SRV',
  PART: 'PEC',
};

/**
 * O prefixo de um `kind`.
 *
 * `ITM` para o que não conhecemos: `kind` é texto no banco, e um fluxo novo
 * aparecer antes de este mapa saber dele é mais provável que o contrário. Cair
 * num código genérico é melhor que cair em `undefined-000001`.
 */
export function skuPrefix(kind: string): string {
  return PREFIXES[kind] ?? 'ITM';
}

/** `PRD-000042` — seis dígitos, pela mesma razão do número da OS: alinha em
 * coluna e se lê em voz alta. Acima de um milhão cresce, em vez de truncar. */
export function formatProductSku(kind: string, sequence: number): string {
  return `${skuPrefix(kind)}-${String(sequence).padStart(6, '0')}`;
}

/** O mínimo que a alocação precisa de um cliente Prisma. */
export interface ProductSkuClient {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  product: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
}

/**
 * Reserva o próximo código para este fluxo, nesta organização.
 *
 * ## Por que um contador, e não `COUNT(*) + 1`
 *
 * A unicidade do SKU é da organização inteira e não distingue item apagado:
 * contar produtos devolveria um número já usado assim que alguém apagasse um, e
 * o índice recusaria a criação. O contador é persistido e incrementado com
 * `ON CONFLICT DO UPDATE` dentro da transação que cria o item — atômico sob
 * concorrência e sem reuso.
 *
 * ## Por que ainda assim procura livre
 *
 * Porque o SKU também pode ser **digitado**: organizações que vêm de outro
 * sistema importam os códigos antigos, e um deles pode ser exatamente
 * `PRD-000007`. O contador então aponta para um número ocupado. Avança até achar
 * livre e leva o contador junto — senão a próxima criação tropeça no mesmo.
 */
export async function allocateProductSku(
  client: ProductSkuClient,
  organizationId: string,
  kind: string,
): Promise<string> {
  const rows = await client.$queryRaw<{ last_value: number }[]>`
    INSERT INTO product_sku_sequences (organization_id, kind, last_value, updated_at)
    VALUES (${organizationId}::uuid, ${kind}, 1, now())
    ON CONFLICT (organization_id, kind) DO UPDATE
      SET last_value = product_sku_sequences.last_value + 1,
          updated_at = now()
    RETURNING last_value
  `;
  const reservado = rows[0]?.last_value;

  /* O `RETURNING` de um `INSERT ... ON CONFLICT DO UPDATE` sempre traz linha.
     Cair aqui significa que a consulta não é mais a que este código pensa que é,
     e seguir com `1` gravaria um código já usado. */
  if (typeof reservado !== 'number') {
    throw new Error(
      'product_sku_sequences did not return the allocated number',
    );
  }

  let sequencia = reservado;
  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    const candidato = formatProductSku(kind, sequencia);
    const existente = await client.product.findFirst({
      where: { organizationId, sku: candidato },
      select: { id: true },
    });
    if (!existente) {
      if (sequencia !== reservado) {
        await client.$executeRaw`
          UPDATE product_sku_sequences
             SET last_value = GREATEST(last_value, ${sequencia}), updated_at = now()
           WHERE organization_id = ${organizationId}::uuid
             AND kind = ${kind}
        `;
      }
      return candidato;
    }
    sequencia += 1;
  }

  /*
   * Cinquenta códigos digitados em sequência a partir do contador. É absurdo o
   * bastante para ser dado corrompido, e insistir devolveria um código que o
   * índice vai recusar — com a causa escondida atrás de um erro de constraint.
   */
  throw new Error(
    `could not allocate a free SKU for ${kind} after 50 attempts`,
  );
}
