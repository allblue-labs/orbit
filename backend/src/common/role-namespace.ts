/** Shared normalization for tenant role names/keys, including legacy keys. */
export function normalizeRoleKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

/** These namespaces are never assignable through tenant role management. */
export function isReservedRoleKey(value: string): boolean {
  return (
    /^(PLATFORM|GLOBAL|CORPORATE|NEXUS)(_|$)/.test(normalizeRoleKey(value)) ||
    normalizeRoleKey(value) === 'PLATFORMADMIN'
  );
}

export function isPlatformPermission(value: string): boolean {
  return value.toLowerCase().startsWith('platform.');
}
