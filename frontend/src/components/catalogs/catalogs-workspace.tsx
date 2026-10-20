"use client";

/**
 * Central de Catálogos.
 *
 * ## O que é um catálogo aqui
 *
 * O que o dono da organização cadastra **uma vez** e a operação reaproveita: o
 * roteiro que o técnico percorre num atendimento, as unidades que um PMOC
 * atende. Antes disso cada um vivia no seu canto — as unidades numa rota solta
 * dentro de PMOC, e os roteiros em lugar nenhum, porque a tela não existia.
 *
 * ## Uma aba por domínio, e não por tela
 *
 * A divisão segue o que cada catálogo alimenta: roteiros vão para atendimentos,
 * unidades vão para planos de PMOC. São vocabulários diferentes com públicos
 * diferentes — juntá-los numa lista só obrigaria a filtrar para achar qualquer
 * coisa.
 *
 * RVT ganhou a sua: o ritmo da visita técnica era um literal de dois valores
 * gravado na configuração, sem onde cadastrar trimestral nem o que conferir em
 * cada tipo. Agora é catálogo como os outros — cada tipo de manutenção com a
 * sua cadência e o seu roteiro.
 */
import { ChecklistTemplatesTab } from "@/components/catalogs/checklist-templates.tab";
import { RvtMaintenanceTypesTab } from "@/components/catalogs/rvt-maintenance-types.tab";
import { PmocUnitsSection } from "@/components/pmoc/pmoc-units.section";
import { ContentContainer } from "@/components/layout/page-primitives";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSectionFromUrl } from "@/hooks/use-section-from-url";
import { TabBoundary } from "@/workspace";

/** Os apelidos das abas, na ordem em que aparecem. */
const SECOES = ["roteiros", "rvt", "pmoc"] as const;

export function CatalogsWorkspace() {
  /* Cada aba é um endereço: um link pode apontar direto para o cadastro certo. */
  const section = useSectionFromUrl(SECOES);

  return (
    <ContentContainer size="wide" className="space-y-6">
      <Tabs value={section.current} onValueChange={section.go}>
        <TabsList aria-label="Catálogos">
          <TabsTrigger value="roteiros">Atendimentos</TabsTrigger>
          <TabsTrigger value="rvt">RVT</TabsTrigger>
          <TabsTrigger value="pmoc">Unidades de PMOC</TabsTrigger>
        </TabsList>

        {/* Uma fronteira por aba: uma falha em PMOC não derruba Atendimentos. */}
        <TabsContent value="roteiros">
          <TabBoundary id="catalog-checklists" label="os roteiros">
            <ChecklistTemplatesTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="rvt">
          <TabBoundary id="catalog-rvt-types" label="os tipos de manutenção">
            <RvtMaintenanceTypesTab />
          </TabBoundary>
        </TabsContent>

        <TabsContent value="pmoc">
          <TabBoundary id="catalog-pmoc-units" label="as unidades de PMOC">
            <PmocUnitsSection />
          </TabBoundary>
        </TabsContent>
      </Tabs>
    </ContentContainer>
  );
}
