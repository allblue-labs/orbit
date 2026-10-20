"use client";

/**
 * Preferências de notificação.
 *
 * ## São pessoais dentro de uma organização
 *
 * `@@unique([organizationId, userId, type])`: a preferência é **de quem
 * recebe**, não da organização. Não existe preferência corporativa — um gestor
 * não decide por e-mail alheio.
 *
 * A aba fica em Configurações porque é lá que se administra o canal, e o
 * enunciado a pede aqui. O que ela salva é do usuário autenticado, e o texto
 * diz isso.
 *
 * ## Upsert por tipo
 *
 * `PATCH /notifications/preferences` grava **um tipo por vez** e não substitui
 * o conjunto. Por isso cada linha salva sozinha, em vez de a tela montar um
 * payload com tudo — o que apagaria as preferências que não estivessem na
 * tela.
 *
 * ## Sem catálogo de eventos
 *
 * `type` é texto livre no DTO. A lista oferecida junta o literal
 * `NotificationType` do contrato com os tipos que **já têm** preferência —
 * inventar uma lista fixa criaria eventos que o backend nunca emite.
 */
import { Bell } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  useNotificationPreferences,
  useSetNotificationPreference,
} from "@/hooks/profile/use-profile";
import { NOTIFICATIONS_POLL_MS } from "@/hooks/notifications/use-notifications";
import { humanizeId } from "@/registry";
import { NotificationType } from "@/types/contracts";
import {
  PREFERENCE_CHANNELS,
  type NotificationPreference,
  type PreferenceChannel,
} from "@/types/settings";

const CHANNEL_LABELS: Readonly<Record<string, string>> = {
  IN_APP: "No app",
  REALTIME: "Tempo real",
  EMAIL: "E-mail",
  PUSH: "Push",
};

const TYPE_LABELS: Readonly<Record<string, string>> = {
  SYSTEM: "Sistema",
  OPERATION: "Operações",
  REPORT: "Relatórios",
  REMINDER: "Lembretes",
};

/** Padrão do banco quando não há preferência gravada. */
const DEFAULT_CHANNELS: readonly string[] = ["IN_APP", "REALTIME"];

export function NotificationsSettingsTab() {
  const query = useNotificationPreferences();
  const save = useSetNotificationPreference();

  if (query.isPending) return <PanelLoading rows={5} />;
  if (query.error) {
    return (
      <PanelError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  const stored = query.data ?? [];
  const byType = new Map(stored.map((item) => [item.type, item]));

  /** Os tipos do contrato somados aos que já têm preferência gravada. */
  const types = [
    ...new Set([...Object.values(NotificationType), ...byType.keys()]),
  ];

  return (
    <div className="max-w-3xl space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Estas preferências são <strong>suas</strong> nesta organização — o
          contrato as guarda por usuário, não por empresa.
        </p>
        <p className="text-xs text-muted-foreground">
          Sem preferência gravada, o padrão é receber no app e em tempo real.
        </p>
      </div>

      <MutationError error={save.error} />

      <ul className="glass-panel divide-y divide-border rounded-xl">
        {types.map((type) => (
          <PreferenceRow
            key={type}
            type={type}
            preference={byType.get(type)}
            saving={save.isPending && save.variables?.type === type}
            onChange={(input) => save.mutate(input)}
          />
        ))}
      </ul>

      <div className="space-y-2 rounded-xl border border-dashed border-border p-4">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Bell className="size-4 text-muted-foreground" aria-hidden />
          O que ainda não é configurável
        </h3>
        <p className="text-xs text-muted-foreground">
          <strong>Horário de silêncio</strong> existe como campo
          (<span className="font-mono">quietHours</span>), mas é JSON livre sem
          esquema — nenhum módulo o interpreta hoje, e um formulário aqui
          gravaria algo que ninguém obedece.
        </p>
        <p className="text-xs text-muted-foreground">
          <strong>SMS</strong> aparece na lista de canais, mas ainda não pode ser escolhido aqui — só <span className="font-mono">IN_APP</span>,{" "}
          <span className="font-mono">REALTIME</span>,{" "}
          <span className="font-mono">EMAIL</span> e{" "}
          <span className="font-mono">PUSH</span>.
        </p>
        <p className="text-xs text-muted-foreground">
          A central de notificações atualiza a cada{" "}
          {Math.round(NOTIFICATIONS_POLL_MS / 1000)}s: a atualização em tempo real ainda não está disponível nesta tela.
        </p>
      </div>
    </div>
  );
}

function PreferenceRow({
  type,
  preference,
  saving,
  onChange,
}: {
  type: string;
  preference: NotificationPreference | undefined;
  saving: boolean;
  onChange: (input: {
    type: string;
    enabled: boolean;
    channels: string[];
  }) => void;
}) {
  const enabled = preference?.enabled ?? true;
  const channels = preference?.channels ?? DEFAULT_CHANNELS;

  const toggleChannel = (channel: PreferenceChannel) => {
    const next = channels.includes(channel)
      ? channels.filter((item) => item !== channel)
      : [...channels, channel];
    onChange({ type, enabled, channels: [...next] });
  };

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {TYPE_LABELS[type] ?? humanizeId(type)}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {preference ? null : (
            <Badge variant="outline" className="text-[10px]">
              padrão
            </Badge>
          )}
          <Switch
            checked={enabled}
            disabled={saving}
            aria-label={`Receber ${TYPE_LABELS[type] ?? humanizeId(type)}`}
            onCheckedChange={(value) =>
              onChange({ type, enabled: value, channels: [...channels] })
            }
          />
        </div>
      </div>

      {enabled ? (
        <ul className="flex flex-wrap gap-1.5">
          {PREFERENCE_CHANNELS.map((channel) => {
            const active = channels.includes(channel);
            return (
              <li key={channel}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => toggleChannel(channel)}
                  className={
                    active
                      ? "rounded-md bg-primary/15 px-2 py-1 text-xs text-primary"
                      : "rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  }
                >
                  {CHANNEL_LABELS[channel] ?? channel}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}
