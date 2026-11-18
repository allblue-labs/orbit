import { Prisma } from '@prisma/client';

export function jsonObject(value: Prisma.JsonValue) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/** Preserve the JSON transport shape, including ISO dates in frozen snapshots. */
export function rvtJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return normalize(value) ?? Prisma.JsonNull;
}

function normalize(value: unknown): Prisma.InputJsonValue | null {
  if (value == null) return null;
  if (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  )
    return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, normalize(item)]),
    );
  }
  throw new TypeError('Unsupported value in RVT JSON');
}
