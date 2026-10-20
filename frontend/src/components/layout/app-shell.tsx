"use client";

import { useState, type ReactNode } from "react";
import { Sidebar, type NavItem } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { CommandPalette, useCommandPalette } from "@/components/navigation/command-palette";
import { SubscriptionExpiredNotice } from "@/components/billing/subscription-expired.notice";

/**
 * Application shell: sidebar + topbar + command palette + main content slot.
 * Every future Orbit module renders inside this shell.
 */
export function AppShell({
  children,
  breadcrumb,
  activeLabel,
  navigation,
}: {
  children: ReactNode;
  breadcrumb?: ReactNode;
  activeLabel?: string;
  navigation?: { group: string; items: NavItem[] }[];
}) {
  const [commandOpen, setCommandOpen] = useState(false);
  useCommandPalette(commandOpen, setCommandOpen);

  return (
    <div className="flex min-h-dvh">
      <Sidebar navigation={navigation} activeLabel={activeLabel} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          onOpenCommand={() => setCommandOpen(true)}
          navigation={navigation}
          activeLabel={activeLabel}
          breadcrumb={breadcrumb}
        />
        <main className="flex-1">{children}</main>
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />

      {/*
        O aviso mora no shell, e não numa página.

        O vencimento vale para a conta inteira: pendurá-lo no painel faria com
        que quem entrasse por um link direto para um atendimento nunca o visse,
        e descobrisse o estado só ao receber um erro ao salvar.
      */}
      <SubscriptionExpiredNotice />
    </div>
  );
}
