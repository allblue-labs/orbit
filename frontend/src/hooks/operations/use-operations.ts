"use client";

/**
 * Hooks do módulo Operations.
 *
 * Cada seção do Workspace tem a sua consulta e a sua cadência — é o que
 * permite recarregar uma área sem tocar nas outras.
 *
 * O escopo ativo entra nas queries: `businessUnitId` é filtro real de
 * `OperationQueryDto`, então trocar de unidade muda a query key e refaz a
 * leitura. Trocar de organização já descarta as queries do escopo anterior
 * (`RequestContextProvider`, PR-02).
 */
import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/api/query-keys";
import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { useActiveScope } from "@/providers/use-active-scope";
import { artifactExecutionsService } from "@/services/artifact-executions.service";
import { customersService } from "@/services/customers.service";
import {
  checklistTemplatesService,
  operationChecklistsService,
  operationIntelligenceService,
  operationsService,
} from "@/services/operations.service";
import type { OperationKind } from "@/types/contracts";
import type {
  AssignOperationUserInput,
  ChangeOperationStatusInput,
  CreateOperationInput,
  OperationCancellationDecision,
  OperationQuery,
  StartChecklistInput,
  UpdateOperationInput,
  CreateChecklistTemplateInput,
  UpdateChecklistTemplateInput,
} from "@/types/operations";

/**
 * Cadência por seção, escolhida pela volatilidade.
 *
 * Timeline e status mudam durante a execução; detalhes e checklists mudam por
 * ação do usuário; anexos só mudam quando alguém envia algo.
 */
/** Quantas linhas o painel de vínculo mostra antes do "Ver tudo". */
const OPERATION_RELATED_PAGE_SIZE = 5;

export const OPERATIONS_REFRESH = {
  list: CACHE.live,
  detail: CACHE.fresh,
  timeline: CACHE.live,
  history: CACHE.stable,
  checklists: CACHE.fresh,
  artifactExecutions: CACHE.fresh,
  intelligence: CACHE.catalog,

  /**
   * O registro de campo envelhece enquanto o técnico trabalha — cada foto nova é
   * uma linha a mais — e as URLs assinadas expiram. `live` mantém a página
   * acompanhando sem que ninguém precise recarregar.
   */
  fieldRecord: CACHE.live,
} as const;

/** Lista paginada. A unidade ativa entra como filtro quando não há escolha explícita. */
export function useOperationsList(query: OperationQuery) {
  const { businessUnitId } = useActiveScope();
  const scopedQuery = useMemo<OperationQuery>(
    () => ({
      ...query,
      businessUnitId: query.businessUnitId ?? businessUnitId ?? undefined,
    }),
    [businessUnitId, query],
  );

  return useApiQuery(
    operationsService.keys.list(scopedQuery),
    ({ signal }) => operationsService.list(scopedQuery, { signal }),
    {
      ...OPERATIONS_REFRESH.list,
      /** Mantém a página anterior visível durante a troca de página. */
      placeholderData: (previous) => previous,
    },
  );
}

export function useOperation(id: string) {
  return useApiQuery(
    operationsService.keys.detail(id),
    ({ signal }) => operationsService.get(id, { signal }),
    OPERATIONS_REFRESH.detail,
  );
}

export function useOperationTimeline(id: string) {
  return useApiQuery(
    operationsService.keys.timeline(id),
    ({ signal }) => operationsService.timeline(id, { signal }),
    { ...OPERATIONS_REFRESH.timeline, refetchOnWindowFocus: true },
  );
}

export function useOperationHistory(id: string) {
  return useApiQuery(
    operationsService.keys.history(id),
    ({ signal }) => operationsService.history(id, { signal }),
    OPERATIONS_REFRESH.history,
  );
}

/**
 * As fotos e o aceite do cliente deste atendimento.
 *
 * Existia só dentro do PDF: quem acompanha pela plataforma não tinha como ver se
 * havia evidência nem se o cliente assinou.
 */
export function useOperationFieldRecord(id: string) {
  return useApiQuery(
    operationsService.keys.fieldRecord(id),
    ({ signal }) => operationsService.fieldRecord(id, { signal }),
    { ...OPERATIONS_REFRESH.fieldRecord, refetchOnWindowFocus: true },
  );
}

export function useOperationChecklists(operationId: string) {
  return useApiQuery(
    operationChecklistsService.keys.byOperation(operationId),
    ({ signal }) =>
      operationChecklistsService.list({ operationId }, { signal }),
    OPERATIONS_REFRESH.checklists,
  );
}

/**
 * As execuções de artefato desta operação.
 *
 * `ArtifactExecutionQueryDto` publica `operationId`, então o recorte é do
 * servidor — nada de trazer a organização inteira e filtrar aqui. A chave da
 * consulta é a mesma que a listagem geral produziria com este filtro, e o
 * `operationId` está dentro dela: duas operações nunca compartilham cache.
 *
 * Não confundir com `useOperationChecklists`: `ChecklistExecution` é outro
 * conceito, com contrato próprio, e continua na sua seção.
 */
export function useOperationArtifactExecutions(operationId: string) {
  const query = {
    operationId,
    limit: OPERATION_RELATED_PAGE_SIZE,
    page: 1,
  } as const;
  return useApiQuery(
    artifactExecutionsService.keys.list(query),
    ({ signal }) => artifactExecutionsService.list(query, { signal }),
    OPERATIONS_REFRESH.artifactExecutions,
  );
}

export function useOperationIntelligence(operationId: string, enabled = true) {
  return useApiQuery(
    operationIntelligenceService.keys.byOperation(operationId),
    ({ signal }) =>
      operationIntelligenceService.list({ operationId }, { signal }),
    { ...OPERATIONS_REFRESH.intelligence, enabled },
  );
}

/**
 * Keys invalidadas após qualquer escrita na operação.
 *
 * O backend registra histórico em toda mutação, então detalhe, timeline e
 * histórico saem juntos — e a lista, porque status e atribuições aparecem lá.
 */
function affectedKeys(id: string) {
  return [
    operationsService.keys.detail(id),
    operationsService.keys.timeline(id),
    operationsService.keys.history(id),
    queryKeys.module("operations"),
  ];
}

/**
 * O que uma mudança de equipe afeta.
 *
 * O detalhe e a listagem, porque ambos mostram quem responde; e a Agenda,
 * porque o backend espelha o responsável nas alocações do evento vinculado.
 * Nada além disso — invalidar tudo derrubaria caches que a troca não tocou.
 */
function assignmentKeys(id: string) {
  return [...affectedKeys(id), queryKeys.module("scheduling")];
}

export function useCreateOperation() {
  const queryClient = useQueryClient();
  return useApiMutation(
    (input: CreateOperationInput) => operationsService.create(input),
    {
      invalidate: [queryKeys.module("operations")],
      notify: "Atendimento criado",
      onSuccess: async (_operation, input) => {
        if (input.customerId) {
          await queryClient.invalidateQueries({
            queryKey: customersService.keys.detail(input.customerId),
          });
        }
      },
    },
  );
}

export function useUpdateOperation(id: string) {
  return useApiMutation(
    (input: UpdateOperationInput) => operationsService.update(id, input),
    {
      /** Edições da mesma operação não disputam a última palavra. */
      scope: { id: `operations:${id}` },
      invalidate: affectedKeys(id),
      notify: "Atendimento atualizado",
    },
  );
}

export function useRemoveOperation() {
  return useApiMutation((id: string) => operationsService.remove(id), {
    invalidate: [queryKeys.module("operations")],
    notify: "Atendimento removido",
  });
}

export function useChangeOperationStatus(id: string) {
  return useApiMutation(
    (input: ChangeOperationStatusInput) =>
      operationsService.changeStatus(id, input),
    {
      invalidate: affectedKeys(id),
      notify: "Situação do atendimento atualizada",
    },
  );
}

export function useAssignOperationUser(id: string) {
  return useApiMutation(
    (input: AssignOperationUserInput) => operationsService.assign(id, input),
    { invalidate: affectedKeys(id), notify: "Pessoa atribuída ao atendimento" },
  );
}

/**
 * Autoriza a atribuição, liberando o atendimento para quem executa.
 *
 * Invalida as mesmas chaves da atribuição: a fila do técnico muda junto, e
 * quem acabou de autorizar precisa ver o estado novo sem recarregar.
 */
export function useSetOperationAuthorization(id: string) {
  return useApiMutation(
    (autorizar: boolean) => operationsService.setAuthorization(id, autorizar),
    {
      invalidate: affectedKeys(id),
      notify: (_data, autorizar) =>
        autorizar ? "Atribuição autorizada" : "Autorização retirada",
    },
  );
}

/**
 * Autoriza várias atribuições numa chamada.
 *
 * Invalida o módulo inteiro, e não as chaves de uma operação: o lote mexe em várias,
 * e a fila de pendências precisa perder as que acabaram de sair dela. Invalidar por
 * id exigiria saber de antemão quais mudaram — que é justamente o que o servidor
 * decide.
 */
export function useAuthorizeOperations() {
  return useApiMutation(
    (operationIds: readonly string[]) =>
      operationsService.authorizeMany(operationIds),
    {
      invalidate: [queryKeys.module("operations")],
      /* O número vem da resposta: o servidor pode ter liberado menos do que a
         tela mandou, e dizer "10 autorizadas" quando foram 8 seria mentira. */
      notify: ({ authorized }) =>
        authorized === 1
          ? "1 atribuição autorizada"
          : `${authorized} atribuições autorizadas`,
    },
  );
}

/**
 * Os pedidos de cancelamento esperando decisão.
 *
 * Carregado só quando a aba de pendências está aberta — é a mesma razão pela qual as
 * abas de Operações montam o conteúdo da ativa: abrir a página não deve disparar as
 * consultas de todas.
 */
export function useOperationCancellationRequests(
  status: "PENDING" | "RESOLVED" = "PENDING",
  enabled = true,
) {
  return useApiQuery(
    operationsService.keys.cancellationRequests(status),
    () => operationsService.cancellationRequests(status),
    { enabled },
  );
}

/**
 * Registra o desfecho do pedido.
 *
 * Invalida o módulo inteiro: resolver muda a fila de pedidos e, nas resoluções que
 * agem sobre o atendimento, o próprio atendimento. Invalidar só a fila deixaria a
 * lista de operações afirmando o estado anterior.
 */
export function useResolveOperationCancellation() {
  return useApiMutation(
    (input: {
      id: string;
      resolution: OperationCancellationDecision;
      notes?: string;
    }) =>
      operationsService.resolveCancellation(input.id, {
        resolution: input.resolution,
        notes: input.notes,
      }),
    {
      invalidate: [queryKeys.module("operations")],
      /* O desfecho entra no texto: "pedido resolvido" não diz o que o técnico
         vai receber como resposta. */
      notify: (_data, { resolution }) =>
        ({
          CANCELLED: "Atendimento marcado para cancelar",
          RESCHEDULED: "Pedido resolvido como remarcação",
          REASSIGNED: "Pedido resolvido como troca de técnico",
          DISMISSED: "Pedido respondido: o atendimento continua",
        })[resolution],
    },
  );
}

export function useUnassignOperationUser(id: string) {
  return useApiMutation(
    (userId: string) => operationsService.unassign(id, userId),
    { invalidate: affectedKeys(id) },
  );
}

/* ------------------------------------------------------------------ */
/* Equipe do atendimento (PR-28)                                       */
/* ------------------------------------------------------------------ */

/**
 * Define ou troca o responsável — e promove um auxiliar, quando é o caso.
 *
 * Uma chamada só. O invariante "responsável não é auxiliar" é do servidor, e
 * é lá que ele é mantido; a tela apenas relê o estado autoritativo depois.
 *
 * A Agenda entra na invalidação porque o vínculo do atendimento espelha nas
 * alocações do evento: trocar o responsável muda quem aparece no calendário.
 */
export function useReplaceOperationResponsible(id: string) {
  return useApiMutation(
    (userId: string) => operationsService.replaceResponsible(id, userId),
    { invalidate: assignmentKeys(id) },
  );
}

export function useAddOperationAuxiliary(id: string) {
  return useApiMutation(
    (userId: string) => operationsService.addAuxiliary(id, userId),
    { invalidate: assignmentKeys(id) },
  );
}

export function useRemoveOperationAuxiliary(id: string) {
  return useApiMutation(
    (userId: string) => operationsService.removeAuxiliary(id, userId),
    { invalidate: assignmentKeys(id) },
  );
}

export function useRemoveOperationAttachment(id: string) {
  return useApiMutation(
    (attachmentId: string) =>
      operationsService.removeAttachment(id, attachmentId),
    { invalidate: affectedKeys(id) },
  );
}

/* ------------------------------------------------------------------ */
/* Modelos de checklist                                                */
/* ------------------------------------------------------------------ */

/**
 * O modelo de checklist deste tipo de atendimento.
 *
 * Só consulta quando há um tipo escolhido: sem ele, a pergunta não existe —
 * e uma consulta sem filtro traria o catálogo inteiro para escolher um.
 *
 * Devolve o primeiro ativo. Se a organização tiver mais de um modelo para o
 * mesmo tipo, é o catálogo que está ambíguo, e resolver isso adivinhando aqui
 * esconderia o problema de quem pode corrigi-lo.
 */
export function useChecklistTemplateForKind(kind: OperationKind | null) {
  const query = useApiQuery(
    checklistTemplatesService.keys.list({
      operationKind: kind ?? undefined,
      isActive: true,
      limit: 1,
    }),
    ({ signal }) =>
      checklistTemplatesService.list(
        { operationKind: kind!, isActive: true, limit: 1 },
        { signal },
      ),
    { enabled: Boolean(kind) },
  );

  return {
    ...query,
    template: query.data?.data?.[0] ?? null,
  };
}

/**
 * O catálogo de modelos de checklist, ativos.
 *
 * Para quem **escolhe** um roteiro — o cadastro de unidade, por exemplo — e
 * não tem um tipo de atendimento para derivá-lo.
 */
export function useChecklistTemplates() {
  return useApiQuery(
    checklistTemplatesService.keys.list({ isActive: true, limit: 100 }),
    ({ signal }) =>
      checklistTemplatesService.list(
        { isActive: true, limit: 100 },
        { signal },
      ),
    CACHE.stable,
  );
}

/** Um roteiro pelo id — o formulário de edição precisa dos itens. */
export function useChecklistTemplate(id: string | null) {
  return useApiQuery(
    checklistTemplatesService.keys.detail(id ?? "none"),
    ({ signal }) => checklistTemplatesService.find(id!, { signal }),
    { ...CACHE.stable, enabled: Boolean(id) },
  );
}

function useChecklistTemplateInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: checklistTemplatesService.keys.module(),
    });
  };
}

export function useCreateChecklistTemplate() {
  const invalidate = useChecklistTemplateInvalidation();
  return useApiMutation(
    (input: CreateChecklistTemplateInput) =>
      checklistTemplatesService.create(input),
    { onSuccess: invalidate },
  );
}

export function useUpdateChecklistTemplate(id: string) {
  const invalidate = useChecklistTemplateInvalidation();
  return useApiMutation(
    (input: UpdateChecklistTemplateInput) =>
      checklistTemplatesService.update(id, input),
    { onSuccess: invalidate },
  );
}

export function useRemoveChecklistTemplate() {
  const invalidate = useChecklistTemplateInvalidation();
  return useApiMutation((id: string) => checklistTemplatesService.remove(id), {
    onSuccess: invalidate,
  });
}

/**
 * Começa a execução do checklist num atendimento.
 *
 * O id vai no disparo, e não na criação do hook: quem cria a operação só o
 * conhece depois da resposta, e um hook que o exigisse antes obrigaria a
 * remontar o componente para usá-lo.
 */
export function useStartOperationChecklist() {
  return useApiMutation(
    ({
      operationId,
      ...input
    }: StartChecklistInput & { operationId: string }) =>
      operationChecklistsService.start(operationId, input),
    { invalidate: [operationChecklistsService.keys.module()] },
  );
}
