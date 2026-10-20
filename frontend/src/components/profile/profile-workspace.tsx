"use client";

/**
 * Profile Workspace — a própria conta.
 *
 * ## A fronteira com Configurações
 *
 * **Perfil** administra o usuário autenticado; **Configurações** administram a
 * plataforma. A linha divisória é o `userId`: tudo em `identity/me` é perfil,
 * inclusive as sessões, que são os dispositivos daquela pessoa.
 *
 * Não há sobreposição com o Workforce Management: lá se administra a equipe —
 * papel, situação, especialidades de **outros**. Aqui, só a própria conta.
 *
 * ```
 * GET/PATCH /identity/me            dados pessoais e preferências
 * POST      /identity/me/password   trocar a própria senha
 * GET/DEL   /identity/me/sessions   dispositivos
 * POST/DEL  /identity/me/mfa/*      dois fatores
 * GET       /session                contexto ativo (do BFF)
 * ```
 */
import { ContentContainer } from "@/components/layout/page-primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSectionFromUrl } from "@/hooks/use-section-from-url";
import { TabBoundary } from "@/workspace";
import { ContextTab } from "./context.tab";
import { PersonalDataTab } from "./personal-data.tab";
import { PreferencesTab } from "./preferences.tab";
import { SecurityTab } from "./security.tab";

/** Os apelidos das seções, na ordem em que aparecem. */
const SECOES = ["dados", "seguranca", "preferencias", "contexto"] as const;

export function ProfileWorkspace() {
  const section = useSectionFromUrl(SECOES);

  return (
    <ContentContainer size="wide" className="space-y-6">
      <Tabs value={section.current} onValueChange={section.go}>
        {/*
          Rotulada porque não é a única lista de abas da página: a seção de
          assinatura tem a sua. Sem nome, quem navega por leitor de tela ouve
          "lista de abas" duas vezes e precisa entrar em cada uma para saber
          qual é qual.
        */}
        <TabsList aria-label="Seções da minha conta">
          <TabsTrigger value="dados">Dados pessoais</TabsTrigger>
          <TabsTrigger value="seguranca">Segurança</TabsTrigger>
          <TabsTrigger value="preferencias">Preferências</TabsTrigger>
          <TabsTrigger value="contexto">Contexto</TabsTrigger>
        </TabsList>

        <TabsContent value="dados">
          <TabBoundary id="profile-personal" label="os dados pessoais">
            <PersonalDataTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="seguranca">
          <TabBoundary id="profile-security" label="a segurança">
            <SecurityTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="preferencias">
          <TabBoundary id="profile-preferences" label="as preferências">
            <PreferencesTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="contexto">
          <TabBoundary id="profile-context" label="o contexto">
            <ContextTab />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </ContentContainer>
  );
}
