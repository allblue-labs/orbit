import { LandingContent } from "@/components/landing/landing-content";
import { carregarCatalogoPublico } from "@/components/pricing/pricing-catalog";

/**
 * Landing.
 *
 * Server Component fino: lê o catálogo público de planos — uma chamada, no
 * servidor — e entrega para o conteúdo, que é de cliente por causa das
 * animações. A separação existe para que a seção de Planos chegue renderizada,
 * e não depois da hidratação.
 */
/**
 * Renderizada a cada requisição.
 *
 * O catálogo de planos vem do backend, e o backend não existe durante o build:
 * gerar esta página estaticamente faria a compilação depender de um servidor
 * no ar — e assaria os preços de um instante no HTML publicado.
 *
 * O custo é pequeno porque a leitura do catálogo é cacheada por cinco minutos
 * no nível do `fetch`: muitas visitas, uma ida ao backend.
 */
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const catalog = await carregarCatalogoPublico();
  return <LandingContent catalog={catalog} />;
}
