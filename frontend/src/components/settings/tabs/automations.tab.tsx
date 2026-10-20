"use client";

/**
 * Configurações → Automações.
 *
 * ## Por que aqui, e não na navegação principal
 *
 * Automação é **governança**: alguém decide uma vez que toda preventiva
 * concluída gera lembrete em seis meses, e depois ninguém volta. Um item fixo
 * na navegação lateral disputaria espaço com o que se abre todo dia — operações,
 * agenda, orçamentos — para uma tela visitada uma vez por trimestre.
 *
 * ## O catálogo manda
 *
 * Gatilhos, ações, operadores e unidades de prazo vêm de
 * `GET /automations/catalog`. Sem ele, o editor não abre — e é o
 * comportamento certo: um formulário montado com uma lista adivinhada
 * ofereceria automações que o motor não sabe disparar.
 *
 * ## Duas autorizações, e elas são diferentes
 *
 * `automations.read` abre a área; `automations.manage` permite criar, editar,
 * ligar, duplicar e excluir. Quem só lê vê as regras que valem na organização
 * — o que é útil e é o que o backend permite —, sem os botões que ele
 * recusaria.
 */
import Link from "next/link";
import { ArrowRight, CalendarClock } from "lucide-react";

import { AutomationRulesPanel } from "@/components/automations/automation-rules.panel";
import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { useAutomationCatalog } from "@/hooks/automations/use-automations";
import { ROUTES } from "@/lib/routes";
import { useActiveScope } from "@/providers/use-active-scope";
import { useSession } from "@/providers/session-provider";

export function AutomationsSettingsTab() {
  const session = useSession();
  const scope = useActiveScope();

  const canRead = session.hasCapability("automations.read");
  const canManage = session.hasCapability("automations.manage");
  const catalog = useAutomationCatalog(canRead);

  /**
   * As unidades que **esta sessão** atende.
   *
   * É o mesmo recorte que o token carrega, e é o que impede oferecer no
   * seletor uma filial que o servidor recusaria. Uma regra nunca deve poder
   * ser criada apontando para fora do contexto autorizado.
   */
  const units = scope.businessUnits.map((unit) => ({
    id: unit.id,
    label: unit.tradeName ?? unit.legalName,
  }));

  if (!canRead) {
    return (
      <div className="max-w-3xl">
        <PanelFrame
          panelId="settings-automations-denied"
          title="Automações"
          description="Regras que fazem o Orbit agir sozinho"
        >
          <p className="text-sm text-muted-foreground">
            Seu acesso não inclui automações. Elas são concedidas
            separadamente: uma regra pode criar lembrete, notificar alguém e
            acionar trabalho interno em nome da organização inteira.
          </p>
        </PanelFrame>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {catalog.isPending ? (
        <PanelFrame
          panelId="settings-automations-loading"
          title="Automações"
          description="Carregando o catálogo de relatórios"
        >
          <PanelLoading rows={4} />
        </PanelFrame>
      ) : catalog.error ? (
        <PanelFrame
          panelId="settings-automations-error"
          title="Automações"
          description="Acontecimentos e ações disponíveis"
        >
          <PanelError
            error={catalog.error}
            onRetry={() => void catalog.refetch()}
          />
        </PanelFrame>
      ) : catalog.data ? (
        <AutomationRulesPanel
          catalog={catalog.data}
          units={units}
          canManage={canManage}
        />
      ) : null}

      <ReminderExample />
      <ScopeNotice />
    </div>
  );
}

/**
 * O caso real, explicado onde ele é configurado.
 *
 * Não é decoração: um prazo de seis meses é a única coisa nesta tela cujo
 * efeito ninguém consegue verificar clicando. Dizer onde o lembrete vai
 * aparecer, e quando, é o que substitui a confirmação imediata que as outras
 * ações têm.
 */
function ReminderExample() {
  return (
    <PanelFrame
      panelId="settings-automations-reminder"
      title="O lembrete de retorno"
      description="O caso que a automação existe para resolver"
    >
      <div className="space-y-4">
        <div className="grid gap-2 rounded-lg border border-border p-3 text-sm sm:grid-cols-[4.5rem_minmax(0,1fr)]">
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Quando
          </span>
          <span>Operação for concluída</span>
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Se
          </span>
          <span>Tipo é igual a Manutenção</span>
          <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Então
          </span>
          <span>Criar lembrete na agenda, em 6 meses</span>
        </div>

        <p className="text-sm text-muted-foreground">
          Quando a ordem de serviço for finalizada, o Orbit guarda o
          compromisso. Passados seis meses <strong>de calendário</strong> — a contagem não depende do relógio deste navegador —, o lembrete aparece sozinho na{" "}
          <strong>Agenda</strong>, no calendário da unidade, apontando para a
          operação que o originou. Ninguém precisa abrir esta tela, nem a
          Agenda, para que isso aconteça.
        </p>

        <p className="text-sm text-muted-foreground">
          Até lá, o lembrete não existe na Agenda: ele está agendado, e a
          situação aparece no histórico da regra como{" "}
          <strong>Agendada</strong>. Desativar a regra antes da hora descarta a
          ação — ela não vira lembrete.
        </p>

        <Button asChild variant="outline" size="sm">
          <Link href={ROUTES.scheduling}>
            <CalendarClock className="size-4" />
            Abrir a Agenda
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </PanelFrame>
  );
}

/**
 * As fronteiras, ditas na tela.
 *
 * A lista existe porque a palavra "automação" carrega expectativa de
 * ferramenta de fluxo — laço, ramificação, webhook, aprovação. Descobrir a
 * ausência depois de desenhar o processo em volta dela é caro; ler antes,
 * não.
 */
function ScopeNotice() {
  return (
    <PanelFrame
      panelId="settings-automations-scope"
      title="O que uma automação faz — e o que não faz"
      description="Fronteiras do motor"
    >
      <ul className="space-y-2 text-sm text-muted-foreground">
        <li>
          <strong className="text-foreground">
            Uma regra é uma frase, não um fluxo.
          </strong>{" "}
          Quando, se, então. Sem ramificação, sem laço, sem etapa de aprovação
          humana no meio.
        </li>
        <li>
          <strong className="text-foreground">Não roda código.</strong> Sem
          script, sem fórmula, sem SQL e sem template executável — as condições
          são comparações declaradas, e só.
        </li>
        <li>
          <strong className="text-foreground">Não chama nada de fora.</strong>{" "}
          Sem webhook, sem URL e sem requisição HTTP. O que uma regra aciona vem de uma lista fechada de ações do Orbit.
        </li>
        <li>
          <strong className="text-foreground">
            O prazo é relativo ao acontecimento.
          </strong>{" "}
          &quot;Seis meses depois de concluir&quot; existe; &quot;todo dia
          5&quot; não — isso é agenda, e mora na Agenda.
        </li>
        <li>
          <strong className="text-foreground">Não repete sozinha.</strong> Cada
          acontecimento dispara a regra uma vez. Uma série recorrente — a
          periodicidade de um PMOC, por exemplo — é evento recorrente da Agenda,
          não automação.
        </li>
        <li>
          <strong className="text-foreground">Não tem teto de disparos.</strong>{" "}
          Uma regra ampla age em todo acontecimento que casar; não há limite por
          período a configurar.
        </li>
        <li>
          <strong className="text-foreground">
            Não abre operação de acompanhamento.
          </strong>{" "}
          A ação existe no catálogo, marcada como indisponível, com o motivo: uma ordem de serviço exige código único, e não há regra
          automática de numeração.
        </li>
      </ul>
    </PanelFrame>
  );
}
