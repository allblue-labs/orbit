import type { Metadata } from "next";

import { PortalLogin } from "@/components/portal/portal-login";

export const metadata: Metadata = {
  title: "Portal do cliente — Orbit",
  robots: { index: false, follow: false },
};

/** Fora do `matcher` do middleware: a sessão do cliente é do BFF do cliente. */
export default function PortalLoginPage() {
  return <PortalLogin />;
}
