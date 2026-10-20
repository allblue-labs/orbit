import type { Metadata } from "next";

import { PmocContractSigning } from "@/components/pmoc/pmoc-contract-signing";

/**
 * O título é fixo e não menciona o contrato nem o token.
 *
 * Aba, histórico e telemetria carregam o `<title>`; o token já viaja no caminho, e
 * repeti-lo aqui o espalharia por mais um lugar sem necessidade.
 */
export const metadata: Metadata = {
  title: "Contrato de manutenção — assinatura",
  /** Nada de indexar: a página só existe para quem tem o link. */
  robots: { index: false, follow: false },
};

/**
 * O contrato do PMOC aberto pelo contratante.
 *
 * Rota pública por construção: não está em `PROTECTED_PREFIXES` nem no `matcher` do
 * middleware, então nenhum portão de navegação a vê. A credencial é o token, e quem a
 * confere é o backend, a cada chamada — `GET /public/pmoc/contracts/:token`.
 *
 * Sem `WorkspacePage`: o shell traz menu, escopo de unidade e o aviso de assinatura,
 * que pressupõem uma sessão. Quem abre esta página não tem conta.
 */
export default async function PmocContractPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return <PmocContractSigning token={token} />;
}
