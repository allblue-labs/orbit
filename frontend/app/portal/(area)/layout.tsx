import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PortalShell } from "@/components/portal/portal-shell";

export const metadata: Metadata = {
  title: "Portal do cliente — Orbit",
  robots: { index: false, follow: false },
};

/**
 * A área do cliente. Não passa pelo middleware da equipe nem pelo shell dela:
 * o porteiro é o `PortalShell`, que pergunta ao BFF do cliente quem entrou.
 */
export default function PortalAreaLayout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
