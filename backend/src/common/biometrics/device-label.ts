/**
 * Um nome reconhecível para a credencial, quando o aparelho não manda um:
 * "Chrome no Mac", "Safari no iPhone". É o que a pessoa vê na lista para
 * saber qual remover.
 */
export function deviceLabelFrom(
  label: string | undefined,
  userAgent: string | undefined,
): string {
  const given = label?.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (given) return given;
  const agent = userAgent ?? '';
  const device = /iPhone/i.test(agent)
    ? 'iPhone'
    : /iPad/i.test(agent)
      ? 'iPad'
      : /Android/i.test(agent)
        ? 'Android'
        : /Mac OS X|Macintosh/i.test(agent)
          ? 'Mac'
          : /Windows/i.test(agent)
            ? 'Windows'
            : /Linux/i.test(agent)
              ? 'Linux'
              : null;
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : null;
  if (browser && device) return `${browser} no ${device}`;
  return browser ?? device ?? 'Este aparelho';
}
