"use client";

/**
 * Query Layer do Customer Workspace.
 *
 * Reúne o módulo próprio e as **quatro consultas cruzadas** que dão ao cliente
 * a visão de 360°. `customerId` é filtro real nos cinco contratos —
 * `AssetQueryDto`, `OperationQueryDto`, `EventQueryDto`,
 * `ArtifactExecutionQueryDto` e `AiExecutionQueryDto` —, então nada é
 * recortado no cliente e todos os serviços já existiam.
 *
 * ## Sem atualização otimista
 *
 * `POST`/`PATCH /customers` podem ser recusados por validação de documento
 * (`IsDocument`) e por regra do servidor. As escritas **semeiam o cache com a
 * resposta**, que é o estado confirmado.
 *
 * Contato é sub-recurso: criar, editar ou remover um contato muda o cliente
 * (que devolve `contacts` embutido), então essas escritas invalidam o detalhe.
 */
import { useQueryClient } from "@tanstack/react-query";

import { useApiMutation } from "@/hooks/api/use-api-mutation";
import { useApiQuery, useInfiniteApiQuery } from "@/hooks/api/use-api-query";
import { CACHE } from "@/hooks/api/cache-policy";
import { artifactExecutionsService } from "@/services/artifact-executions.service";
import { assetsService } from "@/services/assets.service";
import { customersService } from "@/services/customers.service";
import { operationsService } from "@/services/operations.service";
import { operationIntelligenceService } from "@/services/operations.service";
import { schedulingService } from "@/services/scheduling.service";
import type { ArtifactExecutionQuery } from "@/types/artifact-executions";
import type { AssetQuery } from "@/types/assets";
import type { OperationQuery } from "@/types/operations";
import type {
  CreateContactInput,
  CreateCustomerInput,
  Customer,
  CustomerQuery,
  UpdateContactInput,
  UpdateCustomerInput,
  CreateCustomerAddressInput,
  UpdateCustomerAddressInput,
} from "@/types/customers";

/**
 * Cadência por leitura.
 *
 * Cadastro muda por ato deliberado; as listas cruzadas acompanham a cadência
 * do módulo dono. Nenhuma se atualiza sozinha.
 */
export const CUSTOMERS_REFRESH = {
  list: CACHE.stable,
  detail: CACHE.fresh,
  related: CACHE.fresh,
} as const;

/** Horizonte da agenda futura do cliente, em dias. */
const SCHEDULE_HORIZON_DAYS = 90;

export function useCustomersList(query: CustomerQuery) {
  return useApiQuery(
    customersService.keys.list(query),
    ({ signal }) => customersService.list(query, { signal }),
    {
      ...CUSTOMERS_REFRESH.list,
      /** Mantém a página anterior visível durante a troca de página. */
      placeholderData: (previous) => previous,
    },
  );
}

/**
 * Clientes por rolagem infinita, para os seletores.
 *
 * Separado de `useCustomersList`: aquele serve a tabela, que pagina com botões e
 * quer `placeholderData` para não piscar entre páginas. Aqui as páginas se
 * **acumulam**, e a key inclui o termo — trocar a busca recomeça da primeira em
 * vez de somar resultados de buscas diferentes na mesma lista.
 *
 * `enabled` porque o seletor só consulta quando abre: um formulário com quatro
 * seletores fechados não deve disparar quatro consultas ao montar.
 */
export function useInfiniteCustomers(
  search: string | undefined,
  enabled = true,
) {
  return useInfiniteApiQuery<Customer>(
    customersService.keys.list({ search, limit: CUSTOMER_PICKER_PAGE }),
    "/customers",
    { search, limit: CUSTOMER_PICKER_PAGE },
    { ...CUSTOMERS_REFRESH.list, enabled },
  );
}

/**
 * Vinte por página.
 *
 * Enche a altura do painel com sobra e mantém a primeira resposta curta — é a
 * que a pessoa espera olhando. Cinco pediria página nova a cada gesto; cem
 * anularia o motivo de paginar.
 */
const CUSTOMER_PICKER_PAGE = 20;

/**
 * Um cliente.
 *
 * `enabled` pela mesma razão de `useCustomerAddresses`: quem chama nem sempre tem
 * cliente. Sem o guarda, um id vazio dispararia `GET /customers/` — uma
 * requisição que só pode falhar, em toda montagem do componente.
 */
export function useCustomer(id: string, options?: { enabled?: boolean }) {
  return useApiQuery(
    customersService.keys.detail(id),
    ({ signal }) => customersService.get(id, { signal }),
    {
      ...CUSTOMERS_REFRESH.detail,
      enabled: options?.enabled ?? Boolean(id),
    },
  );
}

/**
 * Agenda futura do cliente.
 *
 * Janela de 90 dias — recorte de apresentação. As ocorrências vêm expandidas
 * pelo motor de recorrência do backend; nada de conflito, disponibilidade ou
 * recorrência é calculado aqui.
 */
export function useCustomerSchedule(customerId: string) {
  const from = new Date();
  const to = new Date(from);
  to.setDate(to.getDate() + SCHEDULE_HORIZON_DAYS);

  const query = {
    customerId,
    from: from.toISOString(),
    to: to.toISOString(),
  };

  return useApiQuery(
    schedulingService.keys.occurrences(query),
    ({ signal }) => schedulingService.occurrences(query, { signal }),
    CUSTOMERS_REFRESH.related,
  );
}

/**
 * Orbit Intelligence do cliente.
 *
 * `AiExecutionQueryDto` aceita `customerId` — este é o **primeiro Workspace de
 * entidade com fonte de IA de verdade**. O serviço é o mesmo que a operação
 * usa; só muda o filtro.
 */
/* ------------------------------------------------------------------ */
/* Abas do Workspace V2 — listas paginadas por cliente                  */
/* ------------------------------------------------------------------ */

/**
 * As abas reutilizam as **mesmas chaves** dos módulos donos.
 *
 * `assetsService.keys.list({ customerId, … })` é a mesma key que a listagem
 * geral de equipamentos produziria com aquele filtro. Duas telas pedindo o
 * mesmo recorte compartilham uma consulta — o TanStack Query deduplica por
 * key, e a aba não inventa um cache paralelo.
 *
 * `customerId` já está dentro da key porque entra nos parâmetros da consulta;
 * `businessUnitId` entra quando a tela o informa. A troca de unidade ou de
 * organização descarta tudo isso de uma vez (`RequestContextProvider`), então
 * escopo nunca vaza entre tenants.
 */

/** Equipamentos do cliente, paginados — aba Equipamentos. */
export function useCustomerAssetsList(
  customerId: string,
  query: Omit<AssetQuery, "customerId">,
) {
  const scoped: AssetQuery = { ...query, customerId };
  return useApiQuery(
    assetsService.keys.list(scoped),
    ({ signal }) => assetsService.list(scoped, { signal }),
    { ...CUSTOMERS_REFRESH.related, placeholderData: (previous) => previous },
  );
}

/** Operações do cliente, paginadas — aba Operações. */
export function useCustomerOperationsList(
  customerId: string,
  query: Omit<OperationQuery, "customerId">,
) {
  const scoped: OperationQuery = { ...query, customerId };
  return useApiQuery(
    operationsService.keys.list(scoped),
    ({ signal }) => operationsService.list(scoped, { signal }),
    { ...CUSTOMERS_REFRESH.related, placeholderData: (previous) => previous },
  );
}

/** Execuções do cliente, paginadas — abas Execuções e Documentos. */
export function useCustomerExecutionsList(
  customerId: string,
  query: Omit<ArtifactExecutionQuery, "customerId">,
) {
  const scoped: ArtifactExecutionQuery = { ...query, customerId };
  return useApiQuery(
    artifactExecutionsService.keys.list(scoped),
    ({ signal }) => artifactExecutionsService.list(scoped, { signal }),
    { ...CUSTOMERS_REFRESH.related, placeholderData: (previous) => previous },
  );
}

export function useCustomerIntelligence(customerId: string, enabled = true) {
  const query = { customerId, limit: 10, page: 1 };
  return useApiQuery(
    operationIntelligenceService.keys.byCustomer(customerId),
    ({ signal }) => operationIntelligenceService.list(query, { signal }),
    { ...CUSTOMERS_REFRESH.related, enabled },
  );
}

function useCustomerWriteOptions(id?: string) {
  const queryClient = useQueryClient();

  return {
    onSuccess: async (customer: Customer) => {
      const key = customersService.keys.detail(id ?? customer.id);
      await queryClient.cancelQueries({ queryKey: key });
      /** Estado confirmado pelo servidor — não antecipação. */
      queryClient.setQueryData(key, customer);
      await queryClient.invalidateQueries({
        queryKey: customersService.keys.lists(),
      });
    },
  } as const;
}

export function useCreateCustomer() {
  const options = useCustomerWriteOptions();
  return useApiMutation(
    (input: CreateCustomerInput) => customersService.create(input),
    { ...options, notify: "Cliente cadastrado" },
  );
}

export function useUpdateCustomer(id: string) {
  const options = useCustomerWriteOptions(id);
  return useApiMutation(
    (input: UpdateCustomerInput) => customersService.update(id, input),
    { ...options, scope: { id: `customers:${id}` }, notify: "Cliente atualizado" },
  );
}

/** Escritas de contato refletem no cliente, que devolve `contacts` embutido. */
function useContactInvalidation(customerId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: customersService.keys.detail(customerId),
    });
    await queryClient.invalidateQueries({
      queryKey: customersService.keys.contacts(customerId),
    });
  };
}

export function useCreateContact(customerId: string) {
  const invalidate = useContactInvalidation(customerId);
  return useApiMutation(
    (input: CreateContactInput) =>
      customersService.createContact(customerId, input),
    { onSuccess: invalidate },
  );
}

export function useUpdateContact(customerId: string) {
  const invalidate = useContactInvalidation(customerId);
  return useApiMutation(
    (variables: { contactId: string; input: UpdateContactInput }) =>
      customersService.updateContact(
        customerId,
        variables.contactId,
        variables.input,
      ),
    { onSuccess: invalidate },
  );
}

export function useRemoveContact(customerId: string) {
  const invalidate = useContactInvalidation(customerId);
  return useApiMutation(
    (contactId: string) =>
      customersService.removeContact(customerId, contactId),
    { onSuccess: invalidate },
  );
}

/* ------------------------------------------------------------------ */
/* Endereços de atendimento                                            */
/* ------------------------------------------------------------------ */

/**
 * Os endereços de atendimento de um cliente.
 *
 * Só consulta quando há cliente escolhido: sem ele a pergunta não existe, e o
 * formulário de atendimento chama este hook antes de alguém escolher.
 */
export function useCustomerAddresses(
  customerId: string | null,
  onlyActive = false,
) {
  return useApiQuery(
    customersService.keys.addresses(customerId ?? "none"),
    ({ signal }) =>
      customersService.addresses(customerId!, onlyActive, { signal }),
    { ...CACHE.stable, enabled: Boolean(customerId) },
  );
}

export function useCreateCustomerAddress(customerId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    (input: CreateCustomerAddressInput) =>
      customersService.createAddress(customerId, input),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: customersService.keys.addresses(customerId),
        });
      },
    },
  );
}

export function useUpdateCustomerAddress(customerId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    ({ id, input }: { id: string; input: UpdateCustomerAddressInput }) =>
      customersService.updateAddress(customerId, id, input),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: customersService.keys.addresses(customerId),
        });
      },
    },
  );
}

export function useRemoveCustomerAddress(customerId: string) {
  const queryClient = useQueryClient();
  return useApiMutation(
    (id: string) => customersService.removeAddress(customerId, id),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: customersService.keys.addresses(customerId),
        });
      },
    },
  );
}
