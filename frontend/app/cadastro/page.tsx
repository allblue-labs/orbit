import type { Metadata } from "next";

import { SignupContent } from "@/components/auth/signup-content";
import { carregarCatalogoPublico } from "@/server/public-plan-catalog";
import { signupPlanSelection } from "@/lib/signup-plan-selection";
import { backendJson } from "@/server/backend-client";
import type { LegalDocumentReadModel } from "@/types/contracts/modules/legal/legal.read-models";

export const metadata: Metadata = {
  title: "Criar organização — Orbit",
  description:
    "Abra sua conta no Orbit e escolha o plano da operação. Confira as condições de avaliação de cada plano.",
};

export const dynamic = "force-dynamic";

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{
    plano?: string | string[];
    periodicidade?: string | string[];
  }>;
}) {
  const [catalog, query, terms] = await Promise.all([
    carregarCatalogoPublico(),
    searchParams,
    backendJson<LegalDocumentReadModel>({ path: "/legal/documents/termos" }),
  ]);
  const selection = signupPlanSelection(
    catalog,
    query.plano,
    query.periodicidade,
  );
  return (
    <SignupContent
      key={`${selection.planKey}:${selection.billingInterval}:${terms.version}`}
      catalog={catalog}
      legalVersion={terms.version}
      initialSelection={selection}
    />
  );
}
