import type { Metadata } from "next";
import { QuotePublicAcceptance } from "@/components/quotes/quote-public-acceptance";
export const metadata: Metadata = {
  title: "Conferir e aprovar orçamento — Orbit",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function ProposalPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <QuotePublicAcceptance token={token} />;
}
