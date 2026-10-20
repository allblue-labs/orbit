"use client";

/**
 * Workforce Management — gestão da equipe.
 *
 * ## Não substitui autenticação
 *
 * Aqui não há login, sessão, MFA nem troca de senha: `identity/me` e
 * `identity/sessions` continuam sendo do domínio de autenticação, e cada
 * pessoa administra o próprio perfil. Este módulo é **gestão operacional** —
 * quem faz parte, com que papel, em que unidade, e o que cada um tem para
 * fazer.
 *
 * ## Seis abas, e de onde vem cada uma
 *
 * ```
 * GET /organizations/current/members    usuários (paginado)
 * GET /workforce/specialties            catálogo de especialidades
 * GET /workforce/certifications         habilitações e vencimentos
 * GET /workforce/teams                  equipes
 * GET /scheduling/availability          escalas — já existia
 * GET /operations?assignedUserId=       carga por pessoa
 * ```
 *
 * ## O que saiu, e por quê
 *
 * Profissionais, Localização, Convites, Papéis e Inteligência. Eram onze abas
 * numa linha: a barra quebrava e ninguém achava Usuários, que é o motivo de a
 * tela existir.
 *
 * **Profissionais** mostrava ofício, credencial e assinatura — e não duplicava
 * Técnicos, que mostra papel de acesso e carga. O dado continua inteiro em
 * "Perfil profissional", dentro de cada membro; o que a remoção custa é a visão
 * de elenco — ver de uma vez quem são os Responsáveis Técnicos. Vale registrar,
 * porque é a única das cinco que levou informação junto.
 *
 * **Papéis** oferecia compor permissões à mão, e agora os papéis de técnico
 * nascem prontos com a organização — quem precisa de um sob medida ainda tem o
 * endpoint. **Convites** virou o caminho secundário desde que o owner cadastra
 * a pessoa direto, com senha temporária. **Localização** e **Inteligência** eram
 * leitura sem decisão associada; a de Inteligência era uma ausência declarada.
 *
 * **Escalas não ganharam modelo novo.** `SchedulingAvailability` já tinha tudo
 * — tipo, dia, horário, fuso e vigência — e é o que o motor de agenda consulta
 * ao detectar conflito. Um modelo paralelo divergiria na primeira folga
 * cadastrada só num deles.
 *
 * Cada aba tem `TabBoundary` próprio: uma falha em Escalas não derruba
 * Usuários.
 */
import { ContentContainer } from "@/components/layout/page-primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabBoundary } from "@/workspace";
import { WorkforceKpis } from "./workforce-kpis";
import { useSectionFromUrl } from "@/hooks/use-section-from-url";
import { CertificationsTab } from "./tabs/certifications.tab";
import { MembersTab } from "./tabs/members.tab";
import { ShiftsTab } from "./tabs/shifts.tab";
import { SpecialtiesTab } from "./tabs/specialties.tab";
import { TeamsTab } from "./tabs/teams.tab";
import { TechniciansTab } from "./tabs/technicians.tab";

/** Os apelidos das seções, na ordem em que aparecem. */
const SECOES = [
  "usuarios",
  "tecnicos",
  "equipes",
  "especialidades",
  "certificacoes",
  "escalas",
] as const;

export function WorkforceWorkspace() {
  /*
   * A aba aberta vive no endereço.
   *
   * Era `defaultValue`: a página abria sempre em Usuários, e um link para a aba
   * Técnicos — o que a página de comissão de um técnico usa para voltar — caía
   * na primeira aba. Com a seção no endereço, a volta chega onde saiu, e a aba
   * pode ser guardada nos favoritos.
   */
  const section = useSectionFromUrl(SECOES);

  return (
    <ContentContainer size="wide" className="space-y-6">
      <TabBoundary id="workforce-kpis" label="os indicadores">
        <WorkforceKpis />
      </TabBoundary>

      <Tabs value={section.current} onValueChange={section.go}>
        <TabsList>
          <TabsTrigger value="usuarios">Usuários</TabsTrigger>
          <TabsTrigger value="tecnicos">Técnicos</TabsTrigger>
          <TabsTrigger value="equipes">Equipes</TabsTrigger>
          <TabsTrigger value="especialidades">Especialidades</TabsTrigger>
          <TabsTrigger value="certificacoes">Certificações</TabsTrigger>
          <TabsTrigger value="escalas">Escalas</TabsTrigger>
        </TabsList>

        <TabsContent value="usuarios">
          <TabBoundary id="workforce-members" label="os usuários">
            <MembersTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="tecnicos">
          <TabBoundary id="workforce-technicians" label="a equipe técnica">
            <TechniciansTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="equipes">
          <TabBoundary id="workforce-teams" label="as equipes">
            <TeamsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="especialidades">
          <TabBoundary id="workforce-specialties" label="as especialidades">
            <SpecialtiesTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="certificacoes">
          <TabBoundary id="workforce-certifications" label="as certificações">
            <CertificationsTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="escalas">
          <TabBoundary id="workforce-shifts" label="as escalas">
            <ShiftsTab />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </ContentContainer>
  );
}
