"use client";

/**
 * Integrações.
 *
 * Reusa a `IntegrationsSection` do Organization Workspace (PR-09) — o contrato
 * é o mesmo (`/integrations`), e uma segunda tela divergiria no primeiro
 * provedor novo.
 *
 * A seção declara o que o contrato tem: provedores conhecidos, credenciais
 * guardadas pelo servidor e `POST /:id/validate`. Nenhuma integração é
 * simulada.
 */
import { Plug, Webhook } from "lucide-react";

import { IntegrationsSection } from "@/components/organization/integrations.section";
import { PanelFrame } from "@/components/panels";
import { useSession } from "@/providers/session-provider";

export function IntegrationsSettingsTab() {
  const session = useSession();
  const canManage = session.hasCapability("integrations.manage");

  return (
    <div className="max-w-3xl space-y-6">
      <IntegrationsSection canManage={canManage} />

      <PanelFrame
        panelId="settings-integrations-future"
        title="O que ainda não existe"
        description="Conexões com outros sistemas que ainda estão a caminho"
      >
        <ul className="space-y-3">
          <li className="flex items-start gap-2">
            <Webhook
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">Avisos para outros sistemas</strong> — ainda não disponíveis. Avisar automaticamente um sistema da sua empresa quando algo acontece no Orbit está previsto.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Plug
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">Chaves de integração</strong> — ainda não disponíveis. Hoje todo acesso ao Orbit é feito por uma pessoa com login e senha.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Plug
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">Login único (SSO)</strong> — ainda não é possível entrar com um provedor de identidade da sua empresa. O acesso é feito com senha do próprio Orbit.
            </span>
          </li>
        </ul>

        <p className="mt-3 text-xs text-muted-foreground">
          Quando estiverem disponíveis, estes recursos aparecem nesta aba.
        </p>
      </PanelFrame>
    </div>
  );
}
