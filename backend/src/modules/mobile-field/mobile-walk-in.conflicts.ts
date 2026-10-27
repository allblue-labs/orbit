import { Prisma } from '@prisma/client';
import { ConflictException } from '../../exceptions';

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Inclui conflitos concorrentes que só a restrição do banco pode impedir. */
export function walkInConflict(error: unknown): ConflictException | null {
  let code: string | undefined;
  if (
    error instanceof Error &&
    [
      'WALK_IN_CUSTOMER_DOCUMENT_EXISTS',
      'WALK_IN_ASSET_IDENTIFIER_EXISTS',
      'WALK_IN_ASSET_SERIAL_EXISTS',
    ].includes(error.message)
  )
    code = error.message;
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const driver = record(error.meta?.driverAdapterError);
    const constraint = record(record(driver?.cause)?.constraint);
    const target =
      error.meta?.target ?? constraint?.fields ?? constraint?.index;
    const fields = Array.isArray(target)
      ? target.filter((field): field is string => typeof field === 'string')
      : typeof target === 'string'
        ? [target]
        : [];
    if (
      fields.some((field) =>
        [
          'documentNumber',
          'document_number',
          'customers_document_unique_active',
        ].includes(field),
      )
    )
      code = 'WALK_IN_CUSTOMER_DOCUMENT_EXISTS';
    else if (
      fields.some((field) =>
        ['identifier', 'assets_identifier_unique_active'].includes(field),
      )
    )
      code = 'WALK_IN_ASSET_IDENTIFIER_EXISTS';
    else if (
      fields.some((field) =>
        [
          'serialNumber',
          'serial_number',
          'assets_serial_unique_active',
        ].includes(field),
      )
    )
      code = 'WALK_IN_ASSET_SERIAL_EXISTS';
    else code = 'WALK_IN_CONFLICT';
  }
  return code
    ? new ConflictException('Walk-in uniqueness conflict', code)
    : null;
}
