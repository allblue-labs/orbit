import type { Metadata } from "next";

import { SignupContent } from "@/components/auth/signup-content";
import { carregarCatalogoPublico } from "@/components/pricing/pricing-catalog";
import { signupPlanSelection } from "@/lib/signup-plan-selection";

export const metadata: Metadata = {
  title: "Criar organização — Orbit",
  description:
    "Abra sua conta no Orbit e escolha o plano da operação. O Essencial começa com 30 dias grátis.",
};

/**
 * Cadastro.
 *
 * ## Por que virou Server Component
 *
 * A escolha do plano lia `GET /plans`, que é a **tabela inteira** de planos —
 * incluindo os que as suítes de direitos criam ("Sem financeiro", "Catálogo
 * sem estoque") e os internos (`STARTER`, `OWNER_FULL_ACCESS`). Dez cartões
 * apareciam para quem estava abrindo a conta, metade deles a R$ 0,00.
 *
 * A fonte certa já existia e é a mesma da landing e da página de preços:
 * `GET /plans/catalog`, o catálogo comercial congelado no backend, com os
 * quatro planos e os preços das três periodicidades. Ler daqui é o que garante
 * que o cadastro mostre exatamente o que foi definido — não por um filtro no
 * cliente, que a próxima suíte de teste voltaria a furar.
 */
export const dynamic = "force-dynamic";

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{
    plano?: string | string[];
    periodicidade?: string | string[];
  }>;
}) {
  const catalog = await carregarCatalogoPublico();
  const query = await searchParams;
  const selection = signupPlanSelection(
    catalog,
    query.plano,
    query.periodicidade,
  );
  return (
    <SignupContent
      key={`${selection.planKey}:${selection.billingInterval}`}
      catalog={catalog}
      initialSelection={selection}
    />
  );
}
