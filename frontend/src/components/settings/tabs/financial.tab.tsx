"use client";

/**
 * Configurações financeiras.
 *
 * ## Duas chaves, e só as duas
 *
 * `FinancialSettings` publica `autoRecordReceipts` e `defaultCurrency`. Não há
 * uma terceira aqui porque não há uma terceira no contrato: cada campo muda um
 * comportamento que o servidor de fato executa, e um interruptor que ninguém lê
 * seria configuração inventada.
 *
 * ## Desligar não reescreve o passado
 *
 * É a parte que precisa estar dita na tela, não só na documentação: desligar
 * **não apaga** os lançamentos já criados — são fatos, e o recibo que os
 * originou continua existindo. Religar **não recupera** o período desligado: o
 * gatilho é o evento de emissão, e eventos passados não são reemitidos.
 *
 * Sem esse aviso, alguém desliga o registro automático esperando limpar o
 * caixa, e liga de volta esperando reconstruí-lo. Nenhuma das duas coisas
 * acontece.
 *
 * ## Sem antecipação
 *
 * O `Switch` só muda depois que o servidor confirma. Um interruptor que vira
 * na hora e volta sozinho quando a requisição falha é pior que um que demora:
 * durante o intervalo, ele mente sobre a política que está valendo.
 */
import Link from "next/link";
import { ArrowRight, Receipt, Wallet } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  useFinancialSettings,
  useUpdateFinancialSettings,
} from "@/hooks/financial/use-financial";
import { useSession } from "@/providers/session-provider";
import { ROUTES } from "@/lib/routes";

export function FinancialSettingsTab() {
  const session = useSession();
  const settings = useFinancialSettings();
  const update = useUpdateFinancialSettings();

  /**
   * Quem só lê vê a política, mas não a muda.
   *
   * O backend exige `financial.manage` no `PATCH` e recusaria de qualquer
   * forma; isto evita oferecer um interruptor que voltaria 403.
   */
  const canManage = session.hasCapability("financial.manage");

  /** Sem `financial.read`, nada de financeiro chega — nem a configuração. */
  if (!session.hasCapability("financial.read")) {
    return (
      <div className="max-w-3xl">
        <PanelFrame
          panelId="settings-financial-denied"
          title="Financeiro"
          description="Registro automático de recibos"
        >
          <p className="text-sm text-muted-foreground">
            Seu acesso não inclui o módulo financeiro. Ele é concedido
            separadamente de operações e clientes — ter acesso a uma ordem de
            serviço não dá acesso ao dinheiro dela.
          </p>
        </PanelFrame>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PanelFrame
        panelId="settings-financial-automation"
        title="Recibos e Financeiro"
        description="O que acontece quando um recibo é emitido"
      >
        {settings.isPending ? (
          <PanelLoading rows={2} />
        ) : settings.error ? (
          <PanelError
            error={settings.error}
            onRetry={() => void settings.refetch()}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
              <div className="min-w-0 space-y-1">
                <Label
                  htmlFor="financial-auto-record"
                  className="flex items-center gap-2"
                >
                  <Receipt className="size-4 text-sky-400" aria-hidden />
                  Registrar automaticamente recibos emitidos no Financeiro
                </Label>
                <p className="text-xs text-muted-foreground">
                  Quando um recibo é <strong>oficialmente emitido</strong>, o
                  valor do documento vira uma receita já confirmada, vinculada
                  ao cliente e à operação. O gatilho é a emissão oficial — gerar um PDF não lança nada.
                </p>
              </div>
              <Switch
                id="financial-auto-record"
                checked={settings.data?.autoRecordReceipts ?? false}
                disabled={!canManage || update.isPending}
                onCheckedChange={(checked) =>
                  update.mutate({ autoRecordReceipts: checked })
                }
              />
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">
                Desativar afeta apenas os próximos recibos.
              </p>
              <p className="mt-1">
                Os lançamentos já criados <strong>permanecem</strong> — eles
                registram dinheiro que de fato entrou. E reativar{" "}
                <strong>não recupera</strong> o período em que ficou desligado:
                o lançamento nasce do evento de emissão, e eventos passados não
                se repetem. Para registrar um recibo desse intervalo, lance-o
                manualmente.
              </p>
            </div>

            <dl className="flex items-baseline justify-between text-sm">
              <dt className="text-muted-foreground">Moeda padrão</dt>
              <dd className="font-mono">{settings.data?.defaultCurrency}</dd>
            </dl>

            {canManage ? null : (
              <p className="text-xs text-muted-foreground">
                Você pode consultar esta política, mas alterá-la exige permissão
                de gestão financeira.
              </p>
            )}

            <MutationError error={update.error} />
          </div>
        )}
      </PanelFrame>

      <PanelFrame
        panelId="settings-financial-scope"
        title="O que o Financeiro faz — e o que não faz"
        description="Fronteiras do módulo"
      >
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">Registra o fato.</strong>{" "}
            Entradas e saídas por unidade, com competência, categoria e origem
            rastreável.
          </li>
          <li>
            <strong className="text-foreground">Não é contabilidade.</strong>{" "}
            Sem plano de contas, partidas dobradas, DRE ou apuração fiscal.
          </li>
          <li>
            <strong className="text-foreground">
              Não movimenta dinheiro.
            </strong>{" "}
            Sem conciliação bancária, contas bancárias ou gateway de pagamento —
            confirmar um lançamento registra que o pagamento aconteceu, não o
            executa.
          </li>
          <li>
            <strong className="text-foreground">
              Dinheiro é contado por unidade.
            </strong>{" "}
            Todo lançamento pertence a uma, e quem tem acesso a uma filial não
            enxerga o caixa de outra.
          </li>
        </ul>

        <Button asChild variant="outline" size="sm" className="mt-4">
          <Link href={ROUTES.financial}>
            <Wallet className="size-4" />
            Abrir o Financeiro
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </PanelFrame>
    </div>
  );
}
