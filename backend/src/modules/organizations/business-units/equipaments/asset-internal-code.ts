/**
 * O código interno de um equipamento.
 *
 * ## O que o sistema gera, e o que ele lê
 *
 * `identifierType` diz **o que é** o conteúdo de `identifier`. Número de série, NFC,
 * código de barras e RFID são lidos da máquina física: inventar um número de série é
 * inventar um fato sobre o equipamento do cliente.
 *
 * `INTERNAL_CODE` e `QR_CODE` são diferentes — a organização os **atribui**. O QR
 * entrou nessa lista porque a etiqueta é impressa pelo próprio Orbit
 * (`POST /assets/:id/qr/ensure`, resolvida em `/q/<token>`): o papel segue o
 * sistema, não o contrário. Exigir que alguém digitasse um QR antes de ele existir
 * invertia a ordem dos fatos.
 *
 * O raciocínio antigo — "um QR gerado que não existe em etiqueta nenhuma é uma busca
 * que nunca encontra nada" — valia enquanto o produto não imprimia etiqueta. Ele
 * imprime.
 *
 * ## Por organização, porque o inquilino é a fronteira
 *
 * A unicidade do identificador é `(organizationId, identifier)`, e a contagem
 * acompanha: cada organização começa no `EQP-000001`. Um contador global faria a
 * primeira máquina de um cliente novo nascer com o número de outra empresa — que é
 * vazamento de informação comercial numa etiqueta colada no equipamento.
 */

/** `EQP-000042` — mesma convenção da OS e do SKU: seis dígitos, alinha em coluna. */
export function formatInternalCode(sequence: number): string {
  return `EQP-${String(sequence).padStart(6, '0')}`;
}

/** Os tipos de identificador que o sistema atribui, em vez de ler da máquina. */
export const GENERATED_IDENTIFIER_TYPES: readonly string[] = [
  'INTERNAL_CODE',
  'QR_CODE',
];

/** O tipo padrão quando o cadastro não escolhe: a etiqueta que o Orbit imprime. */
export const DEFAULT_IDENTIFIER_TYPE = 'QR_CODE';

export function isGeneratedIdentifierType(
  type: string | null | undefined,
): boolean {
  return type != null && GENERATED_IDENTIFIER_TYPES.includes(type);
}

/** O mínimo que a alocação precisa de um cliente Prisma. */
export interface AssetInternalCodeClient {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  asset: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
}

/**
 * Reserva o próximo código interno desta organização.
 *
 * Mesmo padrão dos outros contadores do produto: uma linha por inquilino,
 * incrementada com `ON CONFLICT DO UPDATE` dentro da transação que cria o
 * equipamento. `MAX(identifier) + 1` não serviria — o identificador é texto livre
 * para os outros tipos, e o máximo alfabético de uma coluna que guarda QR e número
 * de série não significa nada.
 *
 * ## Por que procura livre, e sem filtrar apagado
 *
 * O código interno também pode ser digitado: quem etiquetou o parque antes de usar
 * o Orbit tem os códigos dele, e um pode ser exatamente o próximo do contador.
 *
 * A busca **não** exclui equipamento apagado, de propósito: o índice único
 * `(organizationId, identifier)` não tem predicado, então um registro em soft
 * delete continua ocupando o código. Filtrar `deletedAt: null` aqui devolveria um
 * código que o banco vai recusar — e o erro apareceria como conflito sem causa
 * visível.
 */
export async function allocateInternalCode(
  client: AssetInternalCodeClient,
  organizationId: string,
): Promise<string> {
  const rows = await client.$queryRaw<{ last_value: number }[]>`
    INSERT INTO asset_internal_code_sequences (organization_id, last_value, updated_at)
    VALUES (${organizationId}::uuid, 1, now())
    ON CONFLICT (organization_id) DO UPDATE
      SET last_value = asset_internal_code_sequences.last_value + 1,
          updated_at = now()
    RETURNING last_value
  `;
  const reservado = rows[0]?.last_value;

  /* `INSERT ... ON CONFLICT DO UPDATE` sempre devolve linha. Cair aqui significa
     que a consulta não é mais a que este código pensa que é, e seguir com `1`
     gravaria um código já usado. */
  if (typeof reservado !== 'number') {
    throw new Error(
      'asset_internal_code_sequences did not return the allocated number',
    );
  }

  let sequencia = reservado;
  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    const candidato = formatInternalCode(sequencia);
    const existente = await client.asset.findFirst({
      where: { organizationId, identifier: candidato },
      select: { id: true },
    });
    if (!existente) {
      if (sequencia !== reservado) {
        await client.$executeRaw`
          UPDATE asset_internal_code_sequences
             SET last_value = GREATEST(last_value, ${sequencia}), updated_at = now()
           WHERE organization_id = ${organizationId}::uuid
        `;
      }
      return candidato;
    }
    sequencia += 1;
  }

  /* Cinquenta códigos ocupados em sequência a partir do contador é dado
     corrompido, não uso normal. Insistir devolveria um código que o índice vai
     recusar, com a causa escondida atrás de um erro de constraint. */
  throw new Error('could not allocate a free internal code after 50 attempts');
}
