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
        description="Superfícies de extensão da plataforma"
      >
        <ul className="space-y-3">
          <li className="flex items-start gap-2">
            <Webhook
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">Webhooks</strong> — ainda não existem. Avisar sistemas externos quando algo acontece no Orbit é uma extensão prevista, ainda não construída.
            </span>
          </li>
          <li className="flex items-start gap-2">
            <Plug
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              aria-hidden
            />
            <span className="text-sm text-muted-foreground">
              <strong className="text-foreground">Chaves de integração</strong> — ainda não existem. Hoje todo acesso é feito por uma pessoa com sessão iniciada; uma chave de sistema teria escopo próprio.
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
          Nada disso é simulado aqui. Quando os contratos existirem, entram como
          seções desta aba consumindo o mesmo Workspace Core — sem tela nova e
          sem tipo paralelo.
        </p>
      </PanelFrame>
    </div>
  );
}
