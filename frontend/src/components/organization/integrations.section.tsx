"use client";

/**
 * Integrações configuradas.
 *
 * **Nota de contrato:** o campo é `lastValidatedAt`, não "última
 * sincronização". `POST /integrations/:id/validate` verifica credenciais — não
 * sincroniza dados, e não existe endpoint que sincronize. A tela usa o nome
 * certo em vez do nome que soaria melhor.
 *
 * `configuration` é JSON livre e `encryptedSecrets` **não é publicado** — o
 * segredo fica no servidor, cifrado. Nada aqui exibe credencial.
 *
 * "Disponibilidade" no sentido de catálogo de provedores não existe: o backend
 * lista o que a organização configurou, não o que poderia configurar. O que a
 * tela mostra sobre disponibilidade é o limite do plano, no painel de plano.
 */
import Link from "next/link";
import { ArrowRight, Plug, RefreshCw, TriangleAlert } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useIntegrations,
  useValidateIntegration,
} from "@/hooks/organization/use-organization";
import { formatDateTime } from "@/lib/formatters";
import { ROUTES } from "@/lib/routes";
import { lifecycleLabel } from "@/registry";
import { cn } from "@/lib/utils";
import type { Integration } from "@/types/organization";

const STATUS_CLASSES: Readonly<Record<string, string>> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-400",
  INACTIVE: "bg-surface-strong text-muted-foreground",
  ERROR: "bg-destructive/15 text-destructive",
  PENDING: "bg-amber-500/15 text-amber-400",
};

export function IntegrationsSection({ canManage }: { canManage: boolean }) {
  const integrations = useIntegrations();
  const validate = useValidateIntegration();

  return (
    <PanelFrame
      panelId="organization-integrations"
      title="Integrações"
      description="Provedores conectados a esta organização"
    >
      <div className="space-y-4">
        <PanelState
          query={toPanelQuery(integrations)}
          loadingRows={3}
          isEmpty={(data) => data.length === 0}
          emptyMessage="Nenhuma integração configurada."
        >
          {(data) => (
            <ul className="space-y-2">
              {data.map((integration) => (
                <IntegrationRow
                  key={integration.id}
                  integration={integration}
                  canManage={canManage}
                  validating={validate.isPending}
                  onValidate={() => validate.mutate(integration.id)}
                />
              ))}
            </ul>
          )}
        </PanelState>

        <MutationError error={validate.error} />

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          As credenciais são conferidas, mas a sincronização de dados e o catálogo de provedores ainda não estão disponíveis. Os segredos ficam cifrados e não são publicados.
        </p>
      </div>
    </PanelFrame>
  );
}

function IntegrationRow({
  integration,
  canManage,
  validating,
  onValidate,
}: {
  integration: Integration;
  canManage: boolean;
  validating: boolean;
  onValidate: () => void;
}) {
  return (
    <li className="space-y-1 rounded-lg border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Plug className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {integration.displayName}
        </span>
        <Badge variant="outline" className="text-[10px]">
          {integration.category}
        </Badge>
        <span
          className={cn(
            "rounded-md px-2 py-0.5 text-[10px] font-medium",
            STATUS_CLASSES[integration.status] ??
              "bg-surface-strong text-muted-foreground",
          )}
        >
          {lifecycleLabel(integration.status)}
        </span>
        {canManage ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={validating}
            onClick={onValidate}
          >
            <RefreshCw className="size-3.5" />
            Validar
          </Button>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        {integration.provider} · última validação:{" "}
        {integration.lastValidatedAt
          ? formatDateTime(integration.lastValidatedAt)
          : "nunca validada"}
      </p>

      {integration.lastError ? (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden />
          {integration.lastError}
        </p>
      ) : null}
    </li>
  );
}

/**
 * Usuários da organização.
 *
 * Painel de ausência declarada, com precisão sobre o que falta:
 *
 * - **listagem** — nenhum endpoint devolve os membros do tenant.
 *   `/identity/me` cobre só o próprio usuário e `/platform-admin/users` é
 *   global, restrito ao administrador da plataforma;
 * - **papéis** — não há rota que liste papéis;
 * - **convite** — `POST /identity/invitations` existe, mas exige `roleId`
 *   (UUID) e não há de onde obtê-lo. Um campo de UUID cru não é uma
 *   funcionalidade;
 * - **status e permissões por usuário** — dependem da listagem.
 *
 * É a mesma lacuna que impede atribuir técnico a uma operação e nomear a
 * equipe de uma execução, registrada desde a PR-01 do aplicativo móvel.
 */
/**
 * Atalho para o Workforce Management.
 *
 * ## Esta seção declarava lacunas que não existem mais
 *
 * Até a PR-17 ela dizia que não havia endpoint para listar membros nem papéis
 * — verdade quando foi escrita. `GET /organizations/current/members` chegou na
 * PR-12 e `GET /organizations/current/roles` na PR-17, e a PR-18 acrescentou
 * edição de membro e CRUD de papéis.
 *
 * O painel agora aponta para o Workspace que administra tudo isso, em vez de
 * repetir a listagem — e em vez de continuar declarando uma ausência que já
 * foi preenchida.
 */
export function UsersSection() {
  return (
    <PanelFrame
      panelId="organization-users"
      title="Equipe"
      description="Membros, papéis, convites e permissões"
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          A equipe é administrada no Workspace próprio: quem faz parte, com que
          papel, em que unidade, convites pendentes e o que cada pessoa tem para
          fazer.
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link href={ROUTES.team}>
            Abrir Equipe
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </PanelFrame>
  );
}
