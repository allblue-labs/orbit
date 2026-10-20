/**
 * O número do recibo.
 *
 * ## Por que o recibo é numerado
 *
 * Ele é o único documento da série que prova um **fato jurídico**: depois de
 * assinado, quem pagou tem como provar que pagou e quem recebeu não pode cobrar de
 * novo. É citado por número — em cobrança, em conciliação e, quando dá briga, em
 * juízo.
 *
 * ## Por que o contador, e não um código montado na tela
 *
 * A execução de artefato exige `code` único por organização. Sem contador, o
 * navegador teria de inventar um: dois recibos emitidos no mesmo minuto colidiriam,
 * e o segundo receberia 409 depois de a pessoa preencher o formulário inteiro.
 *
 * A contagem é independente da ordem de serviço, do SKU e do código interno de
 * equipamento. Recibo é outro fluxo, e somá-lo a qualquer um deles faria o primeiro
 * recibo da organização nascer com um número que ninguém explica.
 */

/** `RC-000042` — a mesma convenção da OS: seis dígitos, alinha em coluna. */
export function formatReceiptNumber(sequence: number): string {
  return `RC-${String(sequence).padStart(6, '0')}`;
}

/** O mínimo que a alocação precisa de um cliente Prisma. */
export interface ReceiptNumberClient {
  $queryRaw<T = unknown>(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<T>;
  $executeRaw(
    query: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<number>;
  artifactExecution: {
    findFirst(args: unknown): Promise<{ id: string } | null>;
  };
}

/**
 * Reserva o próximo número desta organização.
 *
 * `ON CONFLICT DO UPDATE ... RETURNING` incrementa e devolve numa ida só: duas
 * emissões simultâneas são serializadas pelo próprio `UPDATE`, e nenhuma vê o
 * número da outra.
 *
 * Procura livre depois de reservar porque o código da execução é único por
 * organização e **compartilhado com os outros documentos**: um recibo antigo, ou um
 * documento criado por outro caminho, pode já ocupar `RC-000007`. Avança até achar
 * livre e leva o contador junto, senão a emissão seguinte tropeça no mesmo.
 */
export async function allocateReceiptNumber(
  client: ReceiptNumberClient,
  organizationId: string,
): Promise<string> {
  const rows = await client.$queryRaw<{ last_value: number }[]>`
    INSERT INTO receipt_sequences (organization_id, last_value, updated_at)
    VALUES (${organizationId}::uuid, 1, now())
    ON CONFLICT (organization_id) DO UPDATE
      SET last_value = receipt_sequences.last_value + 1,
          updated_at = now()
    RETURNING last_value
  `;
  const reservado = rows[0]?.last_value;

  if (typeof reservado !== 'number') {
    throw new Error('receipt_sequences did not return the allocated number');
  }

  let sequencia = reservado;
  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    const candidato = formatReceiptNumber(sequencia);
    const existente = await client.artifactExecution.findFirst({
      where: { organizationId, code: candidato },
      select: { id: true },
    });
    if (!existente) {
      if (sequencia !== reservado) {
        await client.$executeRaw`
          UPDATE receipt_sequences
             SET last_value = GREATEST(last_value, ${sequencia}), updated_at = now()
           WHERE organization_id = ${organizationId}::uuid
        `;
      }
      return candidato;
    }
    sequencia += 1;
  }

  throw new Error('could not allocate a free receipt number after 50 attempts');
}
