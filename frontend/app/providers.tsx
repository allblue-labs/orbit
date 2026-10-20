"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { AppProviders } from "@/providers";
import { SidebarPreferenceProvider } from "@/components/layout/sidebar-preference";
import { ThemePreferenceProvider } from "@/components/layout/theme-preference";
import type { Theme } from "@/components/layout/theme-cookie";
import { SubscriptionNoticeProvider } from "@/components/billing/subscription-notice-provider";

export function Providers({
  children,
  sidebarCollapsed = true,
  theme = "system",
  avisoAssinaturaDispensado = false,
}: {
  children: ReactNode;
  /** Resolvida no layout raiz, a partir do cookie. */
  sidebarCollapsed?: boolean;
  /** Idem — e `system` é o padrão de quem nunca escolheu. */
  theme?: Theme;
  /**
   * O aviso de assinatura vencida já foi dispensado nas últimas 12h?
   *
   * Lido no layout raiz pelo mesmo motivo do menu e do tema: o primeiro quadro
   * precisa sair certo. O padrão é `false` — na dúvida, avisa.
   */
  avisoAssinaturaDispensado?: boolean;
}) {
  return (
    <AppProviders>
      <ThemePreferenceProvider initialTheme={theme}>
        <TooltipProvider delayDuration={200}>
        {/* No layout raiz, e não no shell: o shell é montado por página e
            remonta a cada navegação, que é o que zerava a escolha. */}
        <SidebarPreferenceProvider initialCollapsed={sidebarCollapsed}>
          <SubscriptionNoticeProvider dispensado={avisoAssinaturaDispensado}>
            {children}
          </SubscriptionNoticeProvider>
        </SidebarPreferenceProvider>
          <Toaster />
        </TooltipProvider>
      </ThemePreferenceProvider>
    </AppProviders>
  );
}
