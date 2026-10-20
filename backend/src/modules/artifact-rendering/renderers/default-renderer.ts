/**
 * Qual motor desenha cada tipo de documento.
 *
 * ## Por que existe um padrão
 *
 * O motor era escolhido por quem pedia a renderização — a tela mandava
 * `pdf.default` porque era o que existia. Com o renderer premium registrado ao
 * lado, deixar a escolha com o chamador significaria que o PMOC sairia bonito
 * na web e pobre no aplicativo, conforme quem lembrasse de trocar a string.
 *
 * Qual documento merece qual desenho é decisão do produto, não do cliente que
 * pede. Quem quiser um motor específico continua podendo pedir — o parâmetro
 * segue aceito, e é assim que se compara a saída de dois motores.
 *
 * ## O padrão é o premium
 *
 * Inclusive para tipo desconhecido: o compositor genérico desenha qualquer
 * template dentro da mesma moldura de marca. `pdf.default` continua no
 * registry para quem já dependia dele — nenhum documento já emitido muda.
 */
export const DEFAULT_RENDERER = 'pdf.premium';

export function defaultRendererFor(artifactType?: string): string {
  void artifactType;
  return DEFAULT_RENDERER;
}
