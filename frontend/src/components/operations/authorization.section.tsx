"use client";

/**
 * Autorização de operações atribuídas.
 *
 * ## A regra é aplicada pelo servidor
 *
 * Por muito tempo esta tela avisava que a chave era gravada e **não fazia
 * nada** — nenhum ponto do backend a lia, e ligá-la não escondia um
 * atendimento sequer. A tela dizia isso com todas as letras em vez de fingir
 * um fluxo que não acontecia, porque esconder só no cliente daria uma falsa
 * sensação de controle: o técnico continuaria vendo tudo pelo aplicativo.
 *
 * Agora existe de verdade. `Operation.authorizedAt` guarda o carimbo, a fila
 * de campo filtra por ele quando a organização exige, e
 * `POST/DELETE /operations/:id/authorization` são os comandos. Um atendimento
 * atribuído e não autorizado não chega ao aplicativo do técnico.
 *
 * ## Ligar hoje não esconde o trabalho de ontem
 *
 * O que já estava atribuído continua visível: a migração carimbou o passado, e
 * a atribuição carimba sozinha enquanto a exigência está desligada. Sem isso a
 * operação chegaria de manhã com a fila vazia e nenhuma explicação.
 *
 * ## A mesma seção em dois lugares
 *
 * Este componente é usado pela aba Autorização (em Operações) e pela aba
 * Operações (em Configurações). É o mesmo componente, não duas cópias — é o
 * que garante que mexer num lugar apareça no outro.
 */
import { Info, ShieldCheck } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Switch } from "@/components/ui/switch";
import {
  useOrganization,
  useUpdateOrganization,
} from "@/hooks/organization/use-organization";
import { useSession } from "@/providers/session-provider";
import type { Organization } from "@/types/organization";
import { AuthorizationQueuePanel } from "./authorization-queue.panel";
import { CancellationQueuePanel } from "./cancellation-queue.panel";

/** Caminho da preferência dentro de `settings`. */
const SETTINGS_NAMESPACE = "operations";
const SETTINGS_KEY = "requireAssignmentAuthorization";

/**
 * Leitura tolerante da preferência.
 *
 * `settings` é `unknown` no contrato — o backend não valida a forma. Qualquer
 * coisa que não seja exatamente `true` é lida como desligado, que é o padrão
 * pedido.
 */
export function readRequiresAuthorization(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  const namespace = (settings as Record<string, unknown>)[SETTINGS_NAMESPACE];
  if (!namespace || typeof namespace !== "object") return false;
  return (namespace as Record<string, unknown>)[SETTINGS_KEY] === true;
}

/**
 * Escrita preservando o resto.
 *
 * `PATCH /organizations/current` **substitui** `settings` inteiro — o serviço
 * do backend faz `settings: input.settings`. Enviar só a chave apagaria tudo
 * o que outra tela gravou, branding incluído.
 */
function withAuthorization(
  settings: unknown,
  value: boolean,
): Record<string, unknown> {
  const base =
    settings && typeof settings === "object"
      ? { ...(settings as Record<string, unknown>) }
      : {};
  const namespace =
    base[SETTINGS_NAMESPACE] && typeof base[SETTINGS_NAMESPACE] === "object"
      ? { ...(base[SETTINGS_NAMESPACE] as Record<string, unknown>) }
      : {};

  namespace[SETTINGS_KEY] = value;
  base[SETTINGS_NAMESPACE] = namespace;
  return base;
}

/**
 * A seção da aba Autorização: a chave e, quando ela está ligada, a fila.
 *
 * `showQueue` é falso em Configurações › Operações, onde o que se ajusta é a
 * preferência: uma fila de trabalho para liberar no meio das configurações seria
 * trabalho operacional escondido num lugar de ajuste. Em Operações é o contrário — é
 * lá que o dono decide o dia.
 */
export function OperationAuthorizationSection({
  showQueue = false,
  timeZone,
}: {
  showQueue?: boolean;
  /** O fuso da unidade, para a fila agrupar por dia civil. */
  timeZone?: string;
} = {}) {
  const organization = useOrganization();

  if (organization.isPending) return <PanelLoading rows={4} />;
  if (organization.error) {
    return (
      <PanelError
        error={organization.error}
        onRetry={() => void organization.refetch()}
      />
    );
  }
  if (!organization.data) return null;

  const enabled = readRequiresAuthorization(organization.data.settings);

  return (
    <div className="space-y-6">
      <AuthorizationForm organization={organization.data} />

      {/*
        A fila só existe onde a exigência existe.
        Desligada, nenhum atendimento espera autorização — a atribuição carimba
        sozinha —, e uma fila sempre vazia faria parecer que algo está travado.
      */}
      {showQueue && enabled ? (
        <AuthorizationQueuePanel timeZone={timeZone ?? "America/Sao_Paulo"} />
      ) : null}

      {/*
        Os pedidos de cancelamento vindos do campo.
        Diferente da fila acima, **não** dependem da exigência de autorização: um
        técnico pode não conseguir atender em qualquer organização, e o relato dele
        precisa de um lugar independente dessa preferência.
      */}
      {showQueue ? <CancellationQueuePanel /> : null}
    </div>
  );
}

function AuthorizationForm({ organization }: { organization: Organization }) {
  const session = useSession();
  const update = useUpdateOrganization();

  const enabled = readRequiresAuthorization(organization.settings);
  const canEdit = session.hasPermission("organization.update");

  return (
    <PanelFrame
      panelId="operations-authorization"
      title="Autorização de operações atribuídas"
      description="Exigir aprovação antes de a operação aparecer para o técnico."
    >
      <div className="space-y-5">
        <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {[
            "Operação criada",
            "Atribuição",
            enabled ? "Autorização" : "Autorização (desligada)",
            "Disponível para execução",
          ].map((step, index, steps) => (
            <li key={step} className="flex items-center gap-2">
              <span
                className={
                  step.startsWith("Autorização") && enabled
                    ? "rounded-md bg-primary/15 px-2 py-1 text-primary"
                    : "rounded-md bg-surface-strong px-2 py-1"
                }
              >
                {step}
              </span>
              {index < steps.length - 1 ? <span aria-hidden>→</span> : null}
            </li>
          ))}
        </ol>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-primary" aria-hidden />
              Exigir autorização após a atribuição
            </p>
            <p className="text-xs text-muted-foreground">
              Preferência da organização inteira. Não há configuração por
              unidade, por tipo de operação ou por técnico — e o contrato não
              publica nenhuma dessas dimensões.
            </p>
          </div>

          <Switch
            checked={enabled}
            disabled={!canEdit || update.isPending}
            aria-label="Exigir autorização após a atribuição"
            onCheckedChange={(checked) =>
              update.mutate({
                settings: withAuthorization(organization.settings, checked),
              })
            }
          />
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-4">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Info className="size-4 text-primary" aria-hidden />
            {enabled
              ? "O que muda com a autorização ligada"
              : "O que muda se você ligar"}
          </p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              · Um atendimento atribuído só aparece na fila do aplicativo depois
              de autorizado.
            </li>
            <li>
              · A liberação fica no próprio atendimento, na aba Equipe, para
              quem pode atribuir.
            </li>
            <li>
              · Revogar tira o atendimento da fila de novo — o que já foi
              executado permanece.
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            O que já está atribuído hoje continua visível: ligar a exigência
            vale para o que for atribuído daqui em diante.
          </p>
        </div>

        {!canEdit ? (
          <p className="text-xs text-muted-foreground">
            Somente quem tem <code>organization.update</code> pode alterar esta
            configuração.
          </p>
        ) : null}

        <MutationError error={update.error} />

        {update.isSuccess ? (
          <p className="text-xs text-emerald-400">Preferência salva.</p>
        ) : null}
      </div>
    </PanelFrame>
  );
}
