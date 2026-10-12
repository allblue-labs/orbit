/**
 * O endereço de quem a organização cadastra.
 *
 * ## Por que o técnico não digita um e-mail
 *
 * O cadastro direto existe porque o convite pressupõe que a pessoa tem e-mail, lê
 * e-mail e conclui um cadastro sozinha — e boa parte de uma equipe de campo não
 * atende às três. É o que o serviço de equipe diz com todas as letras, e é por isso
 * que ele gera uma senha temporária em vez de mandar mensagem.
 *
 * Então o campo não é um endereço de verdade: é **o nome de quem entra**. Pedir um
 * e-mail completo obrigava o owner a inventar um — e ele inventava
 * `joao@gmail.com` de alguém que não existe, ou `joao@joao.com`, e no mês seguinte
 * ninguém sabia qual era o login do João.
 *
 * O formato `nome@organizacao.com` resolve três coisas ao mesmo tempo: o login é
 * previsível, é derivado de quem a pessoa é, e não colide com o de outro inquilino —
 * o e-mail é único na instalação inteira, e o domínio carrega a organização.
 *
 * ## O que este módulo não decide
 *
 * O owner. A conta dele nasce no cadastro da organização, com endereço real, porque
 * é ela que recebe confirmação e recuperação de senha. Nada aqui a alcança.
 *
 * E não decide o convite: lá o endereço **tem** de ser real, porque uma mensagem é
 * enviada para ele.
 */

/** Acentos viram a letra sem acento; o resto do alfabeto latino que aparece em nome. */
const SEM_ACENTO: Readonly<Record<string, string>> = {
  á: "a",
  à: "a",
  ã: "a",
  â: "a",
  ä: "a",
  é: "e",
  è: "e",
  ê: "e",
  ë: "e",
  í: "i",
  ì: "i",
  î: "i",
  ï: "i",
  ó: "o",
  ò: "o",
  õ: "o",
  ô: "o",
  ö: "o",
  ú: "u",
  ù: "u",
  û: "u",
  ü: "u",
  ç: "c",
  ñ: "n",
  ý: "y",
};

const asciiDe = (texto: string): string =>
  texto
    .toLowerCase()
    .split("")
    .map((letra) => SEM_ACENTO[letra] ?? letra)
    .join("");

/**
 * O domínio da organização, a partir do slug dela.
 *
 * O slug é o identificador canônico — único na instalação, derivado do nome quando a
 * organização nasceu. Reslugificar o nome aqui produziria um segundo identificador
 * que divergiria do primeiro na primeira correção de razão social.
 *
 * `null` quando o slug não serve como domínio. Acontece com slug vazio, ou composto
 * só de caracteres que um domínio não aceita — e aí o campo volta a pedir o endereço
 * inteiro, em vez de montar `@.com`.
 */
export function organizationDomain(slug: string | null | undefined): string | null {
  if (!slug) return null;

  const limpo = asciiDe(slug)
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  /* Um rótulo de domínio tem no máximo 63 caracteres, e um que começa ou termina
     em hífen é inválido. Cortar no limite pode deixar o hífen na ponta. */
  const rotulo = limpo.slice(0, 63).replace(/-$/g, "");

  return rotulo.length > 0 ? `${rotulo}.com` : null;
}

/**
 * O nome de entrada sugerido, a partir do nome da pessoa.
 *
 * `João da Silva` → `joao.silva`. Ponto entre as partes porque é a convenção que todo
 * mundo reconhece num login, e porque espaço não existe em endereço.
 *
 * Preposição some: `joao.da.silva` é mais longo para digitar num celular com uma mão
 * suja de graxa, que é onde este login é usado.
 */
const PREPOSICOES = new Set(["da", "de", "do", "das", "dos", "e"]);

export function suggestLocalPart(firstName: string, lastName: string): string {
  const partes = `${firstName} ${lastName}`
    .split(/\s+/)
    .map((parte) => sanitizeLocalPart(parte))
    .filter((parte) => parte.length > 0 && !PREPOSICOES.has(parte));

  return partes.join(".");
}

/**
 * O que a pessoa digitou, reduzido ao que um endereço aceita.
 *
 * Acentos viram ASCII, espaço vira ponto, e o que não cabe em endereço sai. Não
 * recusa: corrigir enquanto se digita é melhor que recusar no fim do formulário —
 * quem digita "José Antônio" quer `jose.antonio`, não um erro.
 */
export function sanitizeLocalPart(input: string): string {
  return asciiDe(input.trim())
    .replace(/\s+/g, ".")
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/\.+/g, ".")
    .replace(/^[.\-_]+|[.\-_]+$/g, "");
}

/** O endereço inteiro, ou `null` quando ainda não dá para montar um. */
export function composeEmail(
  localPart: string,
  domain: string | null,
): string | null {
  const nome = sanitizeLocalPart(localPart);
  if (nome.length === 0 || !domain) return null;
  return `${nome}@${domain}`;
}

/**
 * O endereço inteiro já serve como e-mail?
 *
 * Deliberadamente frouxo: a validação de verdade é do servidor, e o navegador só
 * precisa saber se vale habilitar o botão. Uma expressão rigorosa de RFC aqui
 * recusaria endereços válidos e daria a impressão de que o sistema está errado.
 */
export function looksLikeEmail(value: string): boolean {
  const texto = value.trim();
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(texto);
}

/**
 * A parte local de um endereço que o campo já mostra com o domínio dentro.
 *
 * ## Por que o domínio vive dentro do campo
 *
 * Ele ficava **ao lado**, numa caixa cinza colada ao `input`. Lia-se como um
 * rótulo desbotado grudado na borda, e não como parte do endereço que está
 * sendo escrito.
 *
 * Dentro, o campo mostra o endereço inteiro desde o primeiro caractere — que é
 * o que a pessoa vai usar para entrar. O domínio continua não sendo editável:
 * o que vier depois do primeiro `@` é descartado a cada tecla, e o cursor é
 * mantido antes dele.
 *
 * ## Por que corta no primeiro `@`
 *
 * Porque é o que separa quem digita de onde ela entra. Colar um endereço
 * inteiro — `joao@outraempresa.com` — aproveita o `joao` e mantém o domínio da
 * organização, que é a regra desta forma do campo; quem precisa de outro
 * domínio tem o botão ao lado.
 */
export function localPartOf(composto: string): string {
  const corte = composto.indexOf("@");
  return corte === -1 ? composto : composto.slice(0, corte);
}
