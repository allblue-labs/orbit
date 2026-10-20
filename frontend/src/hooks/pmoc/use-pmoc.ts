"use client";

/**
 * Hooks do PMOC V2.
 *
 * A cadência segue a volatilidade de cada coisa: a configuração muda por ação
 * humana, o ciclo muda quando alguém executa, a preparação de execução muda
 * assim que o RT perde a assinatura ou o plano é suspenso.
 */
import { queryKeys } from "@/api/query-keys";
import { CACHE } from "@/hooks/api/cache-policy";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { useActiveScope } from "@/providers/use-active-scope";
import { pmocService } from "@/services/pmoc.service";
import type {
  PmocPreviewInput,
  CreatePmocPlanInput,
  PmocCoveragePageQuery,
  PmocPlanQuery,
  PmocTimelineQuery,
  UpdatePmocPlanInput,
  CompletePmocExecutionInput,
  CreatePmocUnitInput,
  StartPmocExecutionInput,
  UpdatePmocUnitInput,
} from "@/types/pmoc";
import { useMemo } from "react";

export const PMOC_REFRESH = {
  plans: CACHE.stable,
  plan: CACHE.fresh,
  coverage: CACHE.stable,
  cycles: CACHE.fresh,
  executions: CACHE.fresh,
  /** Elegibilidade muda sem aviso; nunca servir uma decisão velha. */
  preparation: CACHE.live,
  timeline: CACHE.stable,
} as const;

/** Lista de configurações. A unidade ativa recorta, como nos demais módulos. */
export function usePmocPlans(query: PmocPlanQuery) {
  const { businessUnitId } = useActiveScope();
  const scoped = useMemo<PmocPlanQuery>(
    () => ({
      ...query,
      businessUnitId: query.businessUnitId ?? businessUnitId ?? undefined,
    }),
    [businessUnitId, query],
  );

  return useApiQuery(
    pmocService.keys.plans(scoped),
    ({ signal }) => pmocService.list(scoped, { signal }),
    { ...PMOC_REFRESH.plans, placeholderData: (previous) => previous },
  );
}

/**
 * Um plano, pelo id.
 *
 * `enabled` pelo id porque há dois chamadores que o passam vazio: a tela de detalhe
 * enquanto o parâmetro da rota não resolveu, e as ações da linha, que só buscam o
 * detalhe depois do clique em Editar. Sem a porta, os dois pediriam `/pmoc/plans/` e
 * receberiam 404 — um erro de tela para uma pergunta que ninguém fez.
 */
export function usePmocPlan(id: string) {
  return useApiQuery(
    pmocService.keys.plan(id),
    ({ signal }) => pmocService.get(id, { signal }),
    { ...PMOC_REFRESH.plan, enabled: Boolean(id) },
  );
}

export function usePmocCoverage(id: string, query?: PmocCoveragePageQuery) {
  return useApiQuery(
    pmocService.keys.coverage(id, query),
    ({ signal }) => pmocService.coveragePage(id, query, { signal }),
    { ...PMOC_REFRESH.coverage, placeholderData: (previous) => previous },
  );
}

export function usePmocCycles(id: string) {
  return useApiQuery(
    pmocService.keys.cycles(id),
    ({ signal }) => pmocService.cycles(id, { signal }),
    PMOC_REFRESH.cycles,
  );
}

/**
 * As execuções de um ciclo, em uma consulta.
 *
 * O Read Model já traz equipamento, técnicos, evidências e documento de cada
 * linha — nada de buscar equipamento por linha depois.
 */
export function usePmocEquipmentExecutions(
  planId: string,
  cycleId: string | null,
) {
  return useApiQuery(
    pmocService.keys.equipmentExecutions(planId, cycleId ?? ""),
    ({ signal }) =>
      pmocService.equipmentExecutions(planId, cycleId!, { signal }),
    { ...PMOC_REFRESH.executions, enabled: Boolean(cycleId) },
  );
}

export function usePmocExecutionPreparation(
  planId: string,
  cycleId: string | null,
  assetId: string | null,
) {
  return useApiQuery(
    pmocService.keys.preparation(planId, cycleId ?? "", assetId ?? ""),
    ({ signal }) =>
      pmocService.executionPreparation(planId, cycleId!, assetId!, { signal }),
    {
      ...PMOC_REFRESH.preparation,
      enabled: Boolean(cycleId && assetId),
    },
  );
}

export function usePmocTimeline(id: string, query?: PmocTimelineQuery) {
  return useApiQuery(
    pmocService.keys.timeline(id, query),
    ({ signal }) => pmocService.timeline(id, query, { signal }),
    { ...PMOC_REFRESH.timeline, placeholderData: (previous) => previous },
  );
}

/* ------------------------------------------------------------------ */
/* Mutações                                                            */
/* ------------------------------------------------------------------ */

/**
 * O que uma mudança de configuração afeta.
 *
 * O plano e a listagem — e mais nada. Cobertura, ciclos e linha do tempo têm
 * keys próprias e só entram quando a escrita realmente as toca.
 */
function planKeys(id: string) {
  return [pmocService.keys.plan(id), queryKeys.lists("pmoc")];
}

export function useCreatePmocPlan() {
  return useApiMutation(
    (input: CreatePmocPlanInput) => pmocService.create(input),
    { invalidate: [queryKeys.lists("pmoc")] },
  );
}

export function useUpdatePmocPlan(id: string) {
  return useApiMutation(
    (input: UpdatePmocPlanInput) => pmocService.update(id, input),
    { scope: { id: `pmoc:${id}` }, invalidate: planKeys(id) },
  );
}

/**
 * Transições do plano.
 *
 * A máquina de estados é do servidor e chega em `allowedTransitions`; estes
 * hooks apenas enviam o comando que o plano declarou aceitar. Ativar cria o
 * primeiro ciclo, então ciclos e linha do tempo entram na invalidação.
 */
function transitionKeys(id: string) {
  return [
    ...planKeys(id),
    pmocService.keys.cycles(id),
    queryKeys.query("pmoc", "timeline", { id }),
  ];
}

export function useActivatePmocPlan(id: string) {
  return useApiMutation(() => pmocService.activate(id), {
    invalidate: transitionKeys(id),
  });
}

/**
 * Ativa um plano cujo id só existe depois de criá-lo.
 *
 * O par de cima prende o id na chamada do hook, que serve para um plano já na tela.
 * O wizard precisa do contrário: ele cria e ativa na sequência, e o id chega no
 * `onSuccess` da criação — depois de qualquer hook ter sido montado.
 *
 * Invalida o módulo inteiro em vez das chaves de um plano: na criação não há cache
 * daquele id para invalidar, e o que precisa mudar é a listagem.
 */
export function usePmocPlanActivation() {
  return useApiMutation((id: string) => pmocService.activate(id), {
    invalidate: [queryKeys.module("pmoc")],
  });
}

/**
 * Gera o link temporário de assinatura do contrato.
 *
 * Sem `invalidate`: gerar o link não muda nada que a tela mostre — o plano continua
 * com o mesmo status, a mesma cobertura e o mesmo vencimento. O que muda é a
 * existência de um link válido, e isso não é dado de listagem.
 *
 * O token volta no resultado da mutação e **não** entra em cache. Quem chama o usa
 * ali, no `onSuccess`, para montar a URL e copiá-la.
 */
export function useCreatePmocSignatureLink() {
  return useApiMutation((id: string) => pmocService.createSignatureLink(id));
}

export function useSuspendPmocPlan(id: string) {
  return useApiMutation(() => pmocService.suspend(id), {
    invalidate: transitionKeys(id),
  });
}

export function useCancelPmocPlan(id: string) {
  return useApiMutation(() => pmocService.cancel(id), {
    invalidate: transitionKeys(id),
  });
}

/**
 * Atender um equipamento move muita coisa.
 *
 * A linha do equipamento (`equipmentExecutions`), a lista de ciclos — porque
 * concluir o último equipamento fecha o ciclo e abre o seguinte —, o plano, que
 * carrega `lastExecutedAt` e `nextDueOn`, e a linha do tempo.
 *
 * Invalidar só a linha deixaria a tela afirmando que o ciclo está pendente depois
 * de o servidor tê-lo fechado, e o próximo vencimento com a data antiga.
 */
function executionKeys(planId: string, cycleId: string, assetId?: string) {
  return [
    /*
     * A **preparação** entra primeiro, e é a que mais importa.
     *
     * Ela carrega `allowedActions`, que é o que decide em que passo o diálogo
     * abre. Sem invalidá-la, abrir a execução gravava no servidor e a tela
     * continuava oferecendo "abrir" — porque a resposta em cache ainda dizia
     * `START`. O wizard nunca avançava, e nada indicava por quê.
     */
    ...(assetId
      ? [pmocService.keys.preparation(planId, cycleId, assetId)]
      : []),
    pmocService.keys.equipmentExecutions(planId, cycleId),
    pmocService.keys.cycles(planId),
    ...planKeys(planId),
    queryKeys.query("pmoc", "timeline", { id: planId }),
  ];
}

/**
 * Abre a execução de um equipamento.
 *
 * `scope` por equipamento: abrir a manutenção de uma máquina não trava o botão da
 * de baixo — e num ciclo com vinte equipamentos é comum abrir várias em sequência.
 */
export function useStartPmocExecution(
  planId: string,
  cycleId: string,
  assetId: string,
) {
  return useApiMutation(
    (input: StartPmocExecutionInput) =>
      pmocService.startExecution(planId, cycleId, assetId, input),
    {
      scope: { id: `pmoc-start-${cycleId}-${assetId}` },
      invalidate: executionKeys(planId, cycleId, assetId),
    },
  );
}

/**
 * Conclui a execução de um equipamento.
 *
 * O servidor recusa quem não é o técnico escalado — nem o dono — com 403, e a
 * recusa chega à tela como veio. A interface não reimplementa essa regra: ela
 * depende de quem está na sessão, e deduzi-la aqui produziria uma segunda
 * autoridade que divergiria da do servidor.
 */
export function useCompletePmocExecution(
  planId: string,
  cycleId: string,
  /** O equipamento, para invalidar a preparação — é ela que move o passo. */
  assetId: string,
  executionId: string,
) {
  return useApiMutation(
    (input: CompletePmocExecutionInput) =>
      pmocService.completeExecution(planId, cycleId, executionId, input),
    {
      scope: { id: `pmoc-complete-${executionId}` },
      invalidate: executionKeys(planId, cycleId, assetId),
    },
  );
}

/** Emite o relatório de execução deste equipamento. */
export function useGeneratePmocExecutionArtifact(
  planId: string,
  cycleId: string,
  assetId: string,
  executionId: string,
) {
  return useApiMutation(
    () => pmocService.generateExecutionArtifact(executionId),
    {
      scope: { id: `pmoc-artifact-${executionId}` },
      invalidate: executionKeys(planId, cycleId, assetId),
    },
  );
}

/** Cobertura: invalida a cobertura e o plano (o contador `coveredEquipment`). */
function coverageKeys(id: string) {
  return [
    queryKeys.query("pmoc", "coverage", { id }),
    pmocService.keys.plan(id),
  ];
}

/**
 * Baixa o relatório de configuração do plano.
 *
 * Mutação, e não consulta: produz um efeito — o arquivo salvo — e repetir é pedir
 * de novo, não reler um cache. Como consulta, o React Query guardaria o blob e o
 * segundo clique não baixaria nada.
 *
 * `scope` por plano: baixar um não trava o botão do outro na listagem.
 */
export function usePmocPlanDocument(id: string) {
  return useApiMutation(() => pmocService.document(id), {
    scope: { id: `pmoc-document-${id}` },
  });
}

export function useAddPmocCoverage(id: string) {
  return useApiMutation(
    (input: { assetId: string; notes?: string }) =>
      pmocService.addCoverage(id, input.assetId, input.notes),
    { invalidate: coverageKeys(id) },
  );
}

export function useRemovePmocCoverage(id: string) {
  return useApiMutation(
    (coverageId: string) => pmocService.removeCoverage(id, coverageId),
    { invalidate: coverageKeys(id) },
  );
}

/**
 * O código sugerido para o cliente escolhido.
 *
 * `enabled` amarrado ao cliente: sem cliente não há sequência, e pedir a
 * sugestão antes seria uma requisição que o servidor recusa com 400.
 */
export function usePmocCodeSuggestion(customerId: string | null) {
  return useApiQuery(
    ["pmoc", "code-suggestion", customerId ?? ""],
    ({ signal }) => pmocService.codeSuggestion(customerId!, { signal }),
    { enabled: Boolean(customerId), staleTime: 0, gcTime: 0 },
  );
}

/**
 * A projeção da configuração — ciclos, equipamentos e matriz.
 *
 * Roda por mutação, e não por query, porque a entrada é um corpo e porque a
 * tela decide **quando** projetar: a cada tecla digitada na data seria uma
 * requisição por caractere.
 */
export function usePmocPreview() {
  return useApiMutation((input: PmocPreviewInput) =>
    pmocService.preview(input),
  );
}

/**
 * Os nomes sugeridos para um plano.
 *
 * Catálogo da plataforma: não muda por organização, não muda durante a
 * sessão, e por isso pode ser lido uma vez e reaproveitado.
 */
export function usePmocPlanNameOptions() {
  return useApiQuery(
    pmocService.keys.planNameOptions(),
    ({ signal }) => pmocService.planNameOptions({ signal }),
    CACHE.stable,
  );
}

/* ------------------------------------------------------------------ */
/* Unidades                                                            */
/* ------------------------------------------------------------------ */

/**
 * As unidades da organização, com o roteiro de cada uma.
 *
 * O roteiro vem junto porque é o que a tela precisa mostrar na hora de
 * escolher: uma unidade sem checklist entra no plano e não descreve serviço
 * nenhum, e quem marca tem de ver isso antes.
 */
export function usePmocUnits() {
  return useApiQuery(
    pmocService.keys.units(),
    ({ signal }) => pmocService.units({ signal }),
    CACHE.stable,
  );
}

export function useCreatePmocUnit() {
  return useApiMutation(
    (input: CreatePmocUnitInput) => pmocService.createUnit(input),
    { invalidate: [pmocService.keys.units()] },
  );
}

export function useUpdatePmocUnit(id: string) {
  return useApiMutation(
    (input: UpdatePmocUnitInput) => pmocService.updateUnit(id, input),
    { invalidate: [pmocService.keys.units()] },
  );
}

export function useRemovePmocUnit() {
  return useApiMutation((id: string) => pmocService.removeUnit(id), {
    invalidate: [pmocService.keys.units()],
  });
}
