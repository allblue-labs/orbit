"use client";

/**
 * Operações — o atendimento e os dois planos que o originam.
 *
 * - **Visão geral** — o centro de gestão: lista, filtros e todas as ações do
 *   Owner sobre cada operação.
 * - **PMOC** — os contratos de manutenção preventiva.
 * - **RVT** — as configurações de visita técnica.
 * - **Autorização** — a única configuração do módulo, deliberadamente única.
 *   Configurações por unidade, por tipo ou por técnico não existem no contrato
 *   e não seriam granularidade, seriam invenção.
 *
 * ## Por que PMOC e RVT moram aqui
 *
 * Eram três itens paralelos no menu para o mesmo assunto visto de três ângulos:
 * o atendimento avulso, o contrato preventivo que o agenda e a visita técnica
 * que o origina. Quem trabalha nisso alterna entre os três no mesmo dia, e como
 * destinos separados cada troca custava uma navegação e perdia o contexto.
 *
 * ## A aba fica na URL
 *
 * `?secao=pmoc` abre o PMOC, recarregar não volta para a primeira aba, e voltar
 * no navegador desfaz a troca como desfaz qualquer navegação. É o que permite
 * `/pmoc` continuar existindo: ela redireciona para cá com a seção pedida.
 *
 * ## Cada aba pede a própria capability
 *
 * Hoje todos os planos concedem as três, mas a que sai de um plano no futuro
 * será uma delas — e aí a aba precisa **desaparecer**, não abrir para dar erro.
 * A página inteira continua exigindo `operations.read`, que é a regra dela.
 */
import { Suspense } from "react";

import { PanelLoading } from "@/components/panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSectionFromUrl } from "@/hooks/use-section-from-url";
import { PmocCenter } from "@/components/pmoc/pmoc-center";
import { RvtCenter } from "@/components/rvt/rvt-center";
import { useSession } from "@/providers/session-provider";
import { TabBoundary } from "@/workspace";
import { useSchedulingTimeZone } from "@/components/scheduling/use-scheduling-timezone";
import { OperationAuthorizationSection } from "./authorization.section";
import { OPERATIONS_SECTIONS } from "./sections";
import { OperationsList } from "./operations-list";

/**
 * `useSearchParams` exige um limite de Suspense.
 *
 * A leitura do parâmetro só acontece no cliente, e a página declara
 * `suspense={false}` de propósito — as abas resolvem os próprios estados de
 * carga, e uma fronteira em volta de tudo só adiaria a primeira pintura. O
 * limite fica aqui, restrito a quem lê o endereço.
 */
export function OperationsTabs() {
  return (
    <Suspense fallback={<PanelLoading rows={4} />}>
      <Sections />
    </Suspense>
  );
}

function Sections() {
  const session = useSession();

  const canPmoc = session.hasCapability("pmoc.read");
  /* O fuso da unidade: a fila de autorização agrupa por dia civil, e dia civil
     depende de fuso — ver `authorization-queue`. */
  const { timeZone } = useSchedulingTimeZone();
  const canRvt = session.hasCapability("rvt.read");

  /*
   * Só as seções que esta sessão alcança entram na lista.
   *
   * `resolveSection` cai na primeira quando o apelido pedido não está
   * disponível — então `?secao=pmoc` sem `pmoc.read` abre os atendimentos em vez
   * de uma aba vazia ou de um erro.
   */
  const sections = [
    OPERATIONS_SECTIONS.overview,
    ...(canPmoc ? [OPERATIONS_SECTIONS.pmoc] : []),
    ...(canRvt ? [OPERATIONS_SECTIONS.rvt] : []),
    OPERATIONS_SECTIONS.authorization,
  ];

  const section = useSectionFromUrl(sections);

  return (
    <Tabs value={section.current} onValueChange={section.go}>
      <TabsList>
        <TabsTrigger value={OPERATIONS_SECTIONS.overview}>
          Atendimentos
        </TabsTrigger>
        {canPmoc ? (
          <TabsTrigger value={OPERATIONS_SECTIONS.pmoc}>PMOC</TabsTrigger>
        ) : null}
        {canRvt ? (
          <TabsTrigger value={OPERATIONS_SECTIONS.rvt}>RVT</TabsTrigger>
        ) : null}
        {/*
          "Pendências", e não "Autorização": a aba passou a reunir duas filas de
          decisão do dono — as atribuições a liberar e os pedidos de cancelamento
          que o campo devolveu. O apelido da URL continua `autorizacao`, porque
          ele é público e está em link guardado.
        */}
        <TabsTrigger value={OPERATIONS_SECTIONS.authorization}>
          Pendências
        </TabsTrigger>
      </TabsList>

      {/*
        O conteúdo só monta na aba ativa.

        PMOC e RVT carregam listas, contagens e catálogos próprios; montar os
        três de uma vez faria abrir Operações disparar as consultas das três.
      */}
      <TabsContent value={OPERATIONS_SECTIONS.overview}>
        {section.current === OPERATIONS_SECTIONS.overview ? (
          <OperationsList />
        ) : null}
      </TabsContent>

      {canPmoc ? (
        <TabsContent value={OPERATIONS_SECTIONS.pmoc}>
          {section.current === OPERATIONS_SECTIONS.pmoc ? (
            /* Boundary por aba: uma falha no PMOC não derruba os atendimentos. */
            <TabBoundary id="operations-pmoc" label="o PMOC">
              <PmocCenter />
            </TabBoundary>
          ) : null}
        </TabsContent>
      ) : null}

      {canRvt ? (
        <TabsContent value={OPERATIONS_SECTIONS.rvt}>
          {section.current === OPERATIONS_SECTIONS.rvt ? (
            <TabBoundary id="operations-rvt" label="as visitas técnicas">
              <RvtCenter />
            </TabBoundary>
          ) : null}
        </TabsContent>
      ) : null}

      <TabsContent value={OPERATIONS_SECTIONS.authorization}>
        {section.current === OPERATIONS_SECTIONS.authorization ? (
          /*
            Sem limite de largura: a fila de pendências mora aqui, e ela é uma
            lista com botões por linha. Em `max-w-3xl` o nome do atendimento e o
            botão disputavam a mesma faixa estreita.
          */
          <TabBoundary id="operations-authorization" label="as pendências">
            <OperationAuthorizationSection showQueue timeZone={timeZone} />
          </TabBoundary>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
