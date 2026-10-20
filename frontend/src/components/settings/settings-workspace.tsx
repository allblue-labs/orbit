"use client";

/**
 * Settings Workspace — governança da plataforma.
 *
 * ## A fronteira com Perfil
 *
 * **Configurações** administram o que vale para toda a organização;
 * **Perfil** administra o usuário autenticado. A linha divisória é o `userId`:
 * tudo em `identity/me` é perfil, tudo em `organizations/current` é
 * configuração.
 *
 * A exceção declarada são as **preferências de notificação**: o contrato as
 * guarda por `(organizationId, userId, type)`, ou seja, são pessoais dentro de
 * uma organização. Aparecem aqui porque é onde se administra o canal, e a aba
 * diz de quem elas são.
 *
 * ## Configuração vive junto do que ela configura
 *
 * O que já tem Workspace próprio — templates, catálogo, equipe, agenda — é
 * **alcançado** daqui, não duplicado. As abas reusam as seções que já existem
 * (`GeneralSection`, `IntegrationsSection`, `CalendarSetup`,
 * `OperationAuthorizationSection`); nenhuma foi reescrita.
 */
import { ContentContainer } from "@/components/layout/page-primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabBoundary } from "@/workspace";
import { useSectionFromUrl } from "@/hooks/use-section-from-url";
import { AutomationsSettingsTab } from "./tabs/automations.tab";
import { DocumentsSettingsTab } from "./tabs/documents.tab";
import { FinancialSettingsTab } from "./tabs/financial.tab";
import { IntegrationsSettingsTab } from "./tabs/integrations.tab";
import { NotificationsSettingsTab } from "./tabs/notifications.tab";
import { OperationsSettingsTab } from "./tabs/operations.tab";
import { OrganizationTab } from "./tabs/organization.tab";
import { SchedulingSettingsTab } from "./tabs/scheduling.tab";
import { SecuritySettingsTab } from "./tabs/security.tab";
import { SubscriptionSettingsTab } from "./tabs/subscription.tab";

/** Os apelidos das seções, na ordem em que aparecem. */
const TODAS_AS_SECOES = [
  "organizacao",
  "assinatura",
  "operacao",
  "agenda",
  "documentos",
  "financeiro",
  "notificacoes",
  "automacoes",
  "seguranca",
  "integracoes",
] as const;

/**
 * Seções prontas por fora, mas não prontas para serem oferecidas.
 *
 * ## Por que esconder em vez de apagar
 *
 * Integrações tem tela, hooks e testes; o que falta é do servidor — a
 * sincronização de dados e o catálogo de provedores não existem, então a aba
 * aceita credenciais e não faz nada com elas. Oferecer isso é pior que não
 * oferecer: quem cadastra acredita ter integrado.
 *
 * Apagar o código custaria reescrevê-lo quando o backend chegar, e o histórico
 * não substitui código que compila. Uma linha aqui devolve a aba.
 *
 * A seção também sai de `SECOES`, não só da lista de abas: `?secao=integracoes`
 * nos favoritos de alguém cairia numa aba que não existe mais e a página abriria
 * vazia. Fora da lista, o endereço volta para a primeira seção.
 */
const OCULTAS: readonly (typeof TODAS_AS_SECOES)[number][] = ["integracoes"];

const SECOES = TODAS_AS_SECOES.filter((secao) => !OCULTAS.includes(secao));

export function SettingsWorkspace() {
  const section = useSectionFromUrl(SECOES);
  const visivel = (secao: (typeof TODAS_AS_SECOES)[number]) =>
    !OCULTAS.includes(secao);

  return (
    <ContentContainer size="wide" className="space-y-6">
      <Tabs value={section.current} onValueChange={section.go}>
        <TabsList aria-label="Seções das configurações">
          <TabsTrigger value="organizacao">Organização</TabsTrigger>
          <TabsTrigger value="assinatura">Plano e assinatura</TabsTrigger>
          <TabsTrigger value="operacao">Operação</TabsTrigger>
          <TabsTrigger value="agenda">Agenda</TabsTrigger>
          <TabsTrigger value="documentos">Documentos</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="notificacoes">Notificações</TabsTrigger>
          <TabsTrigger value="automacoes">Automações</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
          {visivel("integracoes") ? (
            <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="organizacao">
          <TabBoundary id="settings-organization" label="a organização">
            <OrganizationTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="assinatura">
          <TabBoundary
            id="settings-subscription"
            label="o plano e a assinatura"
          >
            <SubscriptionSettingsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="operacao">
          <TabBoundary id="settings-operations" label="a operação">
            <OperationsSettingsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="agenda">
          <TabBoundary id="settings-scheduling" label="a agenda">
            <SchedulingSettingsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="documentos">
          <TabBoundary id="settings-documents" label="os documentos">
            <DocumentsSettingsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="financeiro">
          <TabBoundary id="settings-financial" label="o financeiro">
            <FinancialSettingsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="notificacoes">
          <TabBoundary id="settings-notifications" label="as notificações">
            <NotificationsSettingsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="automacoes">
          <TabBoundary id="settings-automations" label="as automações">
            <AutomationsSettingsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="seguranca">
          <TabBoundary id="settings-security" label="a segurança">
            <SecuritySettingsTab />
          </TabBoundary>
        </TabsContent>

        {visivel("integracoes") ? (
          <TabsContent value="integracoes">
            <TabBoundary id="settings-integrations" label="as integrações">
              <IntegrationsSettingsTab />
            </TabBoundary>
          </TabsContent>
        ) : null}
      </Tabs>
    </ContentContainer>
  );
}
