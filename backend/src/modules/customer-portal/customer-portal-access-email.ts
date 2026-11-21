/**
 * O login do cliente: `nome@<organização>.com`.
 *
 * Mesma regra do cadastro da equipe (`frontend/src/components/workforce/
 * member-email.ts`): o endereço não é uma caixa de correio, é o nome com que a
 * pessoa entra, e o domínio carrega a organização. O cliente usa o mesmo
 * domínio que os técnicos.
 *
 * ## Por que aqui também, e não só no navegador
 *
 * Na equipe o domínio é sugestão da tela. Aqui ele é **regra**: o servidor
 * monta o endereço a partir do slug e da parte local, e ignora qualquer domínio
 * que o cliente HTTP mande. Um owner não cria `cliente@outra-empresa.com`, e o
 * login só com e-mail continua achando a organização certa.
 */

const SEM_ACENTO: Readonly<Record<string, string>> = {
  á: 'a',
  à: 'a',
  ã: 'a',
  â: 'a',
  ä: 'a',
  é: 'e',
  è: 'e',
  ê: 'e',
  ë: 'e',
  í: 'i',
  ì: 'i',
  î: 'i',
  ï: 'i',
  ó: 'o',
  ò: 'o',
  õ: 'o',
  ô: 'o',
  ö: 'o',
  ú: 'u',
  ù: 'u',
  û: 'u',
  ü: 'u',
  ç: 'c',
  ñ: 'n',
  ý: 'y',
};

const asciiDe = (texto: string): string =>
  texto
    .toLowerCase()
    .split('')
    .map((letra) => SEM_ACENTO[letra] ?? letra)
    .join('');

/** O domínio da organização a partir do slug — idêntico ao da equipe. */
export function organizationEmailDomain(
  slug: string | null | undefined,
): string | null {
  if (!slug) return null;
  const limpo = asciiDe(slug)
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const rotulo = limpo.slice(0, 63).replace(/-$/g, '');
  return rotulo.length > 0 ? `${rotulo}.com` : null;
}

/** O que foi digitado, reduzido ao que uma parte local aceita. */
export function sanitizeLocalPart(input: string): string {
  return asciiDe(input.trim())
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/\.+/g, '.')
    .replace(/^[.\-_]+|[.\-_]+$/g, '')
    .slice(0, 64)
    .replace(/[.\-_]+$/g, '');
}

/** Termos que não dizem quem é o cliente — "Clínica Sol LTDA" vira `clinica.sol`. */
const RUIDO = new Set([
  'da',
  'de',
  'do',
  'das',
  'dos',
  'e',
  'ltda',
  'me',
  'epp',
  'eireli',
  'sa',
  's.a',
  's/a',
]);

/** A parte local sugerida a partir do nome do cliente. */
export function suggestCustomerLocalPart(customerName: string): string {
  const partes = customerName
    .split(/\s+/)
    .map((parte) => parte.toLowerCase())
    .filter((parte) => !RUIDO.has(parte))
    .map((parte) => sanitizeLocalPart(parte))
    .filter((parte) => parte.length > 0);
  return sanitizeLocalPart(partes.slice(0, 3).join('.'));
}

/** O endereço inteiro, ou `null` quando ainda não dá para montar um. */
export function composeAccessEmail(
  localPart: string,
  slug: string | null | undefined,
): string | null {
  /* Só o que vem antes do primeiro `@`: colar um endereço inteiro aproveita
     o nome e mantém o domínio da organização — como no cadastro da equipe. */
  const corte = localPart.indexOf('@');
  const nome = sanitizeLocalPart(
    corte === -1 ? localPart : localPart.slice(0, corte),
  );
  const dominio = organizationEmailDomain(slug);
  if (nome.length === 0 || !dominio) return null;
  return `${nome}@${dominio}`;
}
