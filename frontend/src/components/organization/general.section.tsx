"use client";

/**
 * Identidade da organização, configurações e branding.
 *
 * ## O que o contrato permite editar
 *
 * `UpdateOrganizationDto` aceita exatamente três campos: `displayName`,
 * `primarySegment` e `settings`. Nada mais. Verificado contra a API:
 *
 * ```
 * PATCH /organizations/current  { "timezone": "America/Recife" }
 * → 400  ['property timezone should not exist']
 * ```
 *
 * ## Branding
 *
 * O **logotipo** tem campo de verdade: coluna própria e
 * `PUT /organizations/current/logo`. Ele timbra os documentos de toda unidade
 * que não tenha marca própria, e por isso mora aqui — era o que faltava para
 * quem opera com uma unidade só e procurava a marca da empresa nas
 * configurações da empresa.
 *
 * **Cor e identidade visual continuam sem contrato.** Não há campo no DTO nem
 * no Read Model, e o único lugar onde caberiam é `settings`, que é JSON livre e
 * que o backend **não interpreta**. Então o painel edita `settings` como JSON —
 * o mesmo tratamento que o Artifact Studio dá a `configuration`. Oferecer um
 * seletor de cor que grava `settings.branding.primaryColor` inventaria um
 * esquema que o servidor não conhece e que nenhum outro cliente saberia ler.
 */
import { useState } from "react";
import { Palette } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { JsonField } from "@/components/artifact-studio/studio/json-field";
import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { lifecycleLabel } from "@/registry";
import { Label } from "@/components/ui/label";
import { useUpdateOrganization } from "@/hooks/organization/use-organization";
import { OrganizationLogoField } from "./organization-logo.field";
import { formatDate } from "@/lib/formatters";
import {
  ORGANIZATION_LIMITS,
  type Organization,
  type UpdateOrganizationInput,
} from "@/types/organization";

export function GeneralSection({
  organization,
  canManage,
}: {
  organization: Organization;
  canManage: boolean;
}) {
  const update = useUpdateOrganization();
  const [displayName, setDisplayName] = useState(organization.displayName);
  const [segment, setSegment] = useState(organization.primarySegment);
  const [settings, setSettings] = useState<unknown>(organization.settings);

  const changes: UpdateOrganizationInput = {};
  if (displayName.trim() !== organization.displayName) {
    changes.displayName = displayName.trim();
  }
  if (segment.trim() !== organization.primarySegment) {
    changes.primarySegment = segment.trim();
  }
  if (JSON.stringify(settings) !== JSON.stringify(organization.settings)) {
    changes.settings = (settings ?? {}) as Record<string, unknown>;
  }
  const dirty = Object.keys(changes).length > 0;

  return (
    <PanelFrame
      panelId="organization-general"
      title="Organização"
      description="Identidade, segmento e configurações"
      actions={
        <Badge variant="secondary">
          {lifecycleLabel(organization.status)}
        </Badge>
      }
    >
      <div className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Entry label="Identificador" mono>
            {organization.slug}
          </Entry>
          <Entry label="Id" mono>
            {organization.id}
          </Entry>
          <Entry label="Assinatura desde">
            {organization.subscriptionStartedAt
              ? formatDate(organization.subscriptionStartedAt)
              : "—"}
          </Entry>
          <Entry label="Criada em">{formatDate(organization.createdAt)}</Entry>
        </dl>

        <div className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="organization-name">Nome</Label>
            <Input
              id="organization-name"
              value={displayName}
              disabled={!canManage}
              maxLength={ORGANIZATION_LIMITS.displayNameMaxLength}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organization-segment">Segmento principal</Label>
            <Input
              id="organization-segment"
              value={segment}
              disabled={!canManage}
              maxLength={ORGANIZATION_LIMITS.segmentMaxLength}
              onChange={(event) => setSegment(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Define o segmento usado nos eventos e nas análises.
            </p>
          </div>
        </div>

        <section className="space-y-4 border-t border-border pt-4">
          <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
            <Palette className="size-3.5" aria-hidden />
            Identidade visual
          </h3>

          {/* Salva sozinho, na própria rota: a imagem tem centenas de
              quilobytes e não pode viajar junto do nome a cada gravação. */}
          <OrganizationLogoField canManage={canManage} />

          <JsonField
            id="organization-settings"
            label="settings"
            description="Campos livres, que o servidor guarda e não interpreta. Cores e demais preferências ficam aqui por convenção da organização — o logotipo, não: ele tem campo próprio, acima."
            value={settings}
            disabled={!canManage}
            rows={6}
            onChange={setSettings}
          />
        </section>

        <MutationError error={update.error} />

        {canManage ? (
          <Button
            disabled={!dirty || update.isPending}
            onClick={() => update.mutate(changes)}
          >
            {update.isPending ? "Salvando…" : "Salvar alterações"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sua conta não tem permissão para alterar a organização.
          </p>
        )}

        <p className="border-t border-border pt-3 text-xs text-muted-foreground">
          O contrato aceita alterar apenas nome, segmento e configurações. Fuso
          horário e moeda existem por <strong>unidade</strong>, e nem eles são
          editáveis — ver o painel de unidades.
        </p>
      </div>
    </PanelFrame>
  );
}

function Entry({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={mono ? "mt-1 font-mono text-xs break-all" : "mt-1 text-sm"}
      >
        {children}
      </dd>
    </div>
  );
}
