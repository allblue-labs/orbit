"use client";

/**
 * A entrada do módulo RVT.
 *
 * Duas visões do mesmo domínio, e a diferença entre elas é exatamente a lição
 * que a tela precisa ensinar: **configuração** é a regra, **visita** é o que
 * cai na agenda. Quem administra contratos entra pela primeira; quem
 * acompanha a operação da semana entra pela segunda.
 */
import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabBoundary } from "@/workspace";
import { RvtConfigurationDialog } from "./rvt-configuration.dialog";
import { RvtList } from "./rvt-list";
import { RvtUpcomingPanel } from "./rvt-upcoming";

export function RvtCenter() {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-5">
      <Tabs defaultValue="configuracoes">
        <TabsList>
          <TabsTrigger value="configuracoes">Configurações</TabsTrigger>
          <TabsTrigger value="visitas">Visitas</TabsTrigger>
        </TabsList>

        <TabsContent value="configuracoes">
          <TabBoundary id="rvt-configurations" label="as configurações">
            <RvtList onCreate={() => setCreating(true)} />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="visitas">
          <TabBoundary id="rvt-upcoming" label="as visitas">
            <RvtUpcomingPanel />
          </TabBoundary>
        </TabsContent>
      </Tabs>

      <RvtConfigurationDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}
