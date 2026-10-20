"use client";

/**
 * Agenda em três leituras.
 *
 * - **Visão geral** — o Scheduling Workspace como estava: grade com os painéis
 *   de conflito, disponibilidade e inteligência ao lado.
 * - **Lembretes** — configuração de rotinas que precisam voltar à agenda.
 * - **Calendário** — a mesma grade ocupando a largura inteira, sem a coluna de
 *   análise, para quem quer só enxergar o mês.
 *
 * Visão geral e Calendário são **o mesmo componente** com molduras diferentes
 * (`layout`). Nada é duplicado: as visões de dia, semana, mês e lista, o
 * seletor de período, os filtros e os diálogos são exatamente os mesmos.
 *
 * A aba escolhida não vai para a URL. `EventQueryDto` não tem nada a ver com
 * isso, e a única razão para colocá-la lá seria compartilhar link — o que
 * também exigiria carregar período e filtros, que hoje são estado local do
 * workspace. Fica registrado como possível evolução.
 */
import { useState } from "react";

import { ContentContainer } from "@/components/layout/page-primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReminderCenter } from "./reminders/reminder-center";
import { SchedulingWorkspace } from "./scheduling-workspace";

const TABS = {
  overview: "overview",
  reminders: "reminders",
  calendar: "calendar",
} as const;

type SchedulingTab = (typeof TABS)[keyof typeof TABS];

export function SchedulingTabs() {
  const [tab, setTab] = useState<SchedulingTab>(TABS.overview);

  return (
    /**
     * Um contêiner para a página inteira.
     *
     * Havia três — um à volta da lista de abas e um dentro de cada painel — e
     * cada um trazia o seu `py-6`. Somados ao espaçamento das abas, a Agenda
     * abria com 72px entre a aba e o primeiro conteúdo, contra 28px das
     * restantes páginas. A gutter da página é uma decisão só, e é esta.
     */
    <ContentContainer size="wide">
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as SchedulingTab)}
      >
        <TabsList>
          <TabsTrigger value={TABS.overview}>Visão geral</TabsTrigger>
          <TabsTrigger value={TABS.reminders}>Lembretes</TabsTrigger>
          <TabsTrigger value={TABS.calendar}>Calendário</TabsTrigger>
        </TabsList>

      {/*
       * Cada aba monta e desmonta o seu conteúdo.
       *
       * Manter as três montadas deixaria três conjuntos de consultas em
       * polling ao mesmo tempo — a agenda recarrega a cada dois minutos.
       */}
        <TabsContent value={TABS.overview}>
          {tab === TABS.overview ? <SchedulingWorkspace /> : null}
        </TabsContent>

        <TabsContent value={TABS.reminders}>
          {tab === TABS.reminders ? <ReminderCenter /> : null}
        </TabsContent>

        <TabsContent value={TABS.calendar}>
          {tab === TABS.calendar ? (
            <SchedulingWorkspace layout="calendar" initialView="MONTH" />
          ) : null}
        </TabsContent>
      </Tabs>
    </ContentContainer>
  );
}
