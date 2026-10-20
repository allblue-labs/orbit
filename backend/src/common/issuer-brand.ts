/**
 * A marca que timbra um documento.
 *
 * ## Duas marcas, uma resposta
 *
 * A unidade emissora pode ter logo próprio — uma filial com identidade visual
 * separada existe. Quando não tem, o documento sai com a marca da empresa. Sem
 * essa regra, quem opera com uma unidade só teria de cadastrar a mesma imagem
 * no lugar menos óbvio: o cadastro da unidade, e não as configurações da
 * empresa, que é onde se procura.
 *
 * ## Por que é função, e não um `??` em cada lugar
 *
 * São cinco geradores de documento — PMOC, ordem de serviço, orçamento,
 * relatório gerencial e a renderização de artefato. Cinco cópias de uma
 * precedência é uma precedência que vai divergir, e a divergência aparece só
 * quando alguém repara que o orçamento saiu sem timbre e a OS saiu com.
 *
 * Quem chama recebe o data URI cru; validar é trabalho de `readEmbeddedImage`,
 * que roda depois, no ponto de desenho.
 */

/**
 * `organization` é **obrigatório** de propósito.
 *
 * Se fosse opcional, uma consulta que esquecesse de trazer a marca da empresa
 * satisfaria o tipo, compilaria, e o documento sairia sem timbre — falha
 * silenciosa, visível só no PDF que o cliente recebe. Obrigatório, esquecer o
 * `select` é erro de compilação.
 *
 * O emissor inteiro continua podendo ser nulo: há geração sem unidade nenhuma.
 */
export interface BrandedIssuer {
  readonly logoUrl?: string | null;
  readonly organization: { readonly logoUrl?: string | null } | null;
}

export function issuerLogo(
  issuer: BrandedIssuer | null | undefined,
): string | null {
  return issuer?.logoUrl ?? issuer?.organization?.logoUrl ?? null;
}
