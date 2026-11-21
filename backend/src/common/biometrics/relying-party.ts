/**
 * Quem o navegador enxerga como "este site" na hora da biometria.
 *
 * O WebAuthn amarra cada chave a um domínio (o RP ID) e confere a origem de
 * cada cerimônia. As origens são as mesmas que o CORS já aceita
 * (`FRONTEND_ORIGIN`); o RP ID é o domínio delas, ou `WEBAUTHN_RP_ID` quando
 * o site e a API vivem em subdomínios diferentes de um mesmo domínio.
 */
export interface RelyingParty {
  readonly id: string;
  readonly name: string;
  readonly origins: readonly string[];
}

export function relyingPartyFrom(
  environment: Record<string, string | undefined>,
): RelyingParty | null {
  const origins = (environment.FRONTEND_ORIGIN ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && value !== '*')
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
  if (!origins.length) return null;
  const id = (
    environment.WEBAUTHN_RP_ID?.trim() || new URL(origins[0]!).hostname
  ).toLowerCase();
  /* O navegador recusa origem fora do domínio; aqui também. */
  const scoped = origins.filter((origin) => {
    const host = new URL(origin).hostname.toLowerCase();
    return host === id || host.endsWith(`.${id}`);
  });
  if (!scoped.length) return null;
  return {
    id,
    name: environment.WEBAUTHN_RP_NAME?.trim() || 'Orbit',
    origins: scoped,
  };
}
