"use client";

/**
 * Criação e edição de operação.
 *
 * Escreve em `POST /operations` e `PATCH /operations/:id`. O que o DTO exige
 * está aqui e nada além: unidade, código, tipo, título, descrição, prioridade,
 * janela prevista, cliente e ativo.
 *
 * ## O que não é decidido aqui
 *
 * - **Status.** Quem o define na criação é o backend, a partir da janela
 *   informada: criar com agendamento devolveu `SCHEDULED`, não `OPEN`
 *   (verificado). Depois disso só muda por `PATCH /operations/:id/status`, que
 *   valida a transição — `SCHEDULED → SCHEDULED` é recusado com mensagem. O
 *   formulário não oferece o campo.
 * - **Código.** É livre no contrato (`@MinLength(2)`), sem unicidade
 *   declarada e sem geração no servidor. O formulário sugere um formato ao
 *   criar e deixa editar; quem recusa duplicidade, se houver regra, é o
 *   backend.
 * - **Conflito de agenda.** Operação não passa pelo motor de agenda — a
 *   janela prevista é informativa, e nenhuma sobreposição é avaliada.
 *
 * ## Referências
 *
 * Cliente e ativo reaproveitam o `ReferencePicker` da agenda, que consulta
 * `/customers` e `/assets` reais. Quando o plano não concede `crm.read` ou
 * `assets.read`, o backend responde 403 e o seletor declara a
 * indisponibilidade em vez de sumir sem explicação.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ReferencePicker } from "@/components/scheduling/reference-picker";
import { schedulingReferencesService } from "@/services/scheduling-references.service";
import {
  useAddOperationAuxiliary,
  useCreateOperation,
  useRemoveOperationAuxiliary,
  useReplaceOperationResponsible,
  useUpdateOperation,
} from "@/hooks/operations/use-operations";
import { instantFromZoned, zonedParts } from "@/lib/scheduling";
import { X } from "lucide-react";

import { useStartOperationChecklist } from "@/hooks/operations/use-operations";
import {
  useFieldAssistants,
  useFieldTechnicians,
} from "@/hooks/workforce/use-workforce";
import { useSession } from "@/providers/session-provider";
import { useActiveScope } from "@/providers/use-active-scope";
import { OperationKind, OperationPriority } from "@/types/contracts";
import {
  OPERATION_LIMITS,
  type CreateOperationInput,
  type ChecklistItem,
  type OperationListItem,
} from "@/types/operations";
import { operationKindLabel, operationPriorityLabel } from "./operation-badges";
import { PROFESSIONAL_ROLES } from "@/registry";
import { comandosDeAtribuicao } from "./operation-assignment-commands";
import { OperationAddressField } from "./operation-address.field";
import { OperationChecklistField } from "./operation-checklist.field";
import { OperationEquipmentField } from "./operation-equipment.field";

/** `Select` não aceita item de valor vazio; este é o "ninguém ainda". */
const SEM_RESPONSAVEL = "__none__";

interface FormState {
  businessUnitId: string;
  code: string;
  kind: string;
  title: string;
  description: string;
  priority: string;
  startLocal: string;
  customerId: string;
  /** Os equipamentos atendidos — era um só. */
  assetIds: string[];
  /** Para onde o técnico vai: um endereço cadastrado do cliente. */
  customerAddressId: string;
  /** O ponto exato dentro do endereço. Opcional. */
  sector: string;
  /** O técnico em campo pode ver quanto este atendimento vale? */
  amountVisibleInField: boolean;
  responsibleId: string;
  auxiliaryIds: string[];
  /// Itens acrescentados só para este atendimento.
  checklistExtras: ChecklistItem[];
}

/**
 * Contexto que já se conhece antes de abrir o formulário.
 *
 * Existe para a entrada por etiqueta QR: o servidor prepara o atendimento
 * (`GET /assets/:id/service-order-preparation`) e devolve equipamento, cliente
 * e unidade. Preencher **não** é criar — o formulário abre como qualquer
 * outro, e a criação continua dependendo de alguém confirmar.
 *
 * Os rótulos acompanham os identificadores porque os seletores mostram nome, e
 * sem eles o campo apareceria preenchido com um UUID.
 */
export interface OperationPrefill {
  readonly businessUnitId?: string;
  readonly customerId?: string;
  readonly assetId?: string;
  readonly title?: string;
  readonly customerLabel?: string;
  readonly assetLabel?: string;
}

export function OperationFormDialog({
  open,
  editing,
  timeZone,
  prefill,
  onOpenChange,
}: {
  open: boolean;
  /** Operação em edição, ou `null` para criação. */
  editing: OperationListItem | null;
  timeZone: string;
  prefill?: OperationPrefill;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {open ? (
          <OperationForm
            editing={editing}
            timeZone={timeZone}
            prefill={prefill}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function OperationForm({
  editing,
  timeZone,
  prefill,
  onClose,
}: {
  editing: OperationListItem | null;
  timeZone: string;
  prefill?: OperationPrefill;
  onClose: () => void;
}) {
  const session = useSession();
  const { businessUnitId } = useActiveScope();
  const create = useCreateOperation();
  const checklist = useStartOperationChecklist();
  const update = useUpdateOperation(editing?.id ?? "");
  /* Os três comandos de atribuição: o `PATCH` não troca técnicos. */
  const replaceResponsible = useReplaceOperationResponsible(editing?.id ?? "");
  const addAuxiliary = useAddOperationAuxiliary(editing?.id ?? "");
  const removeAuxiliary = useRemoveOperationAuxiliary(editing?.id ?? "");
  const mutation = editing ? update : create;

  /*
   * O estado dos comandos de atribuição conta junto.
   *
   * Sem isto, uma falha ao trocar o responsável não apareceria — o `PATCH` teria
   * dado certo, `mutation.error` ficaria nulo, e a tela fecharia como se a equipe
   * tivesse sido salva. O botão também precisa continuar desabilitado enquanto a
   * sequência roda.
   */
  const equipePendente =
    replaceResponsible.isPending ||
    addAuxiliary.isPending ||
    removeAuxiliary.isPending;
  const erroDeEquipe =
    replaceResponsible.error ?? addAuxiliary.error ?? removeAuxiliary.error;

  const [form, setForm] = useState<FormState>(() =>
    initialState(
      editing,
      businessUnitId,
      session.businessUnits,
      timeZone,
      prefill,
    ),
  );
  const [labels, setLabels] = useState<{ customer?: string; asset?: string }>(
    () => ({
      customer:
        editing?.customer?.tradeName ??
        editing?.customer?.legalName ??
        prefill?.customerLabel,
      asset: editing?.assets?.[0]?.name ?? prefill?.assetLabel,
    }),
  );

  const edit = (patch: Partial<FormState>) =>
    setForm((current) => ({ ...current, ...patch }));

  /**
   * Aplica a mudança de equipe pelos comandos de atribuição.
   *
   * Em série, e não em paralelo: a troca de responsável retira o escolhido dos
   * auxiliares no servidor, e as chamadas seguintes precisam ver esse estado. Em
   * paralelo, remover um auxiliar e promovê-lo disputariam a mesma linha.
   *
   * Erros não são silenciados — `useApiMutation` os publica, e o diálogo já mostra o
   * erro da mutação. O que não acontece é fechar a tela com a equipe pela metade: o
   * `await` garante que o fechamento venha depois da última chamada.
   */
  const aplicarEquipe = async () => {
    if (!editing) return;
    const comandos = comandosDeAtribuicao(
      {
        responsavel: editing.responsibleFieldTechnicianId ?? "",
        auxiliares: (editing.auxiliaryTechnicians ?? []).map(
          (item) => item.userId,
        ),
      },
      { responsavel: form.responsibleId, auxiliares: form.auxiliaryIds },
    );

    for (const comando of comandos) {
      if (comando.tipo === "responsavel") {
        await replaceResponsible.mutateAsync(comando.userId);
      } else if (comando.tipo === "adicionar-auxiliar") {
        await addAuxiliary.mutateAsync(comando.userId);
      } else {
        await removeAuxiliary.mutateAsync(comando.userId);
      }
    }
  };

  /** O modelo de checklist do tipo escolhido, quando existe. */
  const [checklistTemplateId, setChecklistTemplateId] = useState<string | null>(
    null,
  );

  const valid =
    form.businessUnitId.length > 0 &&
    form.code.trim().length >= OPERATION_LIMITS.codeMinLength &&
    form.title.trim().length >= OPERATION_LIMITS.titleMinLength &&
    form.kind.length > 0;

  const submit = () => {
    if (editing) {
      /*
       * Salvar a edição é duas coisas, nesta ordem.
       *
       * Os campos do atendimento vão no `PATCH`; a mudança de equipe vai pelos
       * comandos de atribuição, que o `PATCH` recusa de propósito. A equipe é aplicada
       * **depois** porque o comando devolve o atendimento já atualizado — e porque um
       * erro nele não deve desfazer o que o `PATCH` gravou, que é informação boa.
       */
      update.mutate(buildPayload(form, timeZone, "editar"), {
        onSuccess: () => {
          void aplicarEquipe().then(onClose);
        },
      });
      return;
    }

    create.mutate(buildPayload(form, timeZone, "criar"), {
      /**
       * O checklist começa **depois** da operação, porque precisa do id dela.
       *
       * A falha em anexar não desfaz a criação e não segura a tela: o
       * atendimento existe, e o checklist pode ser iniciado por dentro dele.
       * Fechar só depois da segunda chamada faria uma indisponibilidade do
       * checklist parecer falha ao criar o atendimento.
       */
      onSuccess: (operation) => {
        if (checklistTemplateId) {
          checklist.mutate({
            operationId: operation.id,
            templateId: checklistTemplateId,
            additionalItems: form.checklistExtras,
          });
        }
        onClose();
      },
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? `Editar ${editing.code}` : "Nova operação"}
        </DialogTitle>
        <DialogDescription>
          Horários no fuso {timeZone}. A situação inicial e as mudanças
          possíveis seguem as regras do atendimento.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="operation-title">Título</Label>
          <Input
            id="operation-title"
            value={form.title}
            maxLength={OPERATION_LIMITS.titleMaxLength}
            onChange={(event) => edit({ title: event.target.value })}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="operation-code">Código</Label>
          <Input
            id="operation-code"
            value={form.code}
            maxLength={OPERATION_LIMITS.codeMaxLength}
            onChange={(event) => edit({ code: event.target.value })}
            className="font-mono text-sm"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="operation-kind">Tipo</Label>
          <Select
            value={form.kind}
            onValueChange={(value) => edit({ kind: value })}
          >
            <SelectTrigger id="operation-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(OperationKind).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {operationKindLabel(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="operation-priority">Prioridade</Label>
          <Select
            value={form.priority}
            onValueChange={(value) => edit({ priority: value })}
          >
            <SelectTrigger id="operation-priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(OperationPriority).map((priority) => (
                <SelectItem key={priority} value={priority}>
                  {operationPriorityLabel(priority)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/*
          Só o começo.

          "Fim previsto" saiu: quem agenda sabe quando o técnico chega, não
          quando termina — a duração depende do que for encontrado no local.
          Um campo que pede uma previsão que ninguém tem produz dado que
          ninguém confere. O contrato mantém `scheduledEnd` opcional; o
          formulário deixa de pedi-lo.
        */}
        <div className="space-y-2">
          <Label htmlFor="operation-start">Início previsto</Label>
          <Input
            id="operation-start"
            type="datetime-local"
            value={form.startLocal}
            onChange={(event) => edit({ startLocal: event.target.value })}
          />
        </div>

        {/*
          O cliente comanda o resto.

          A unidade de negócio saiu do formulário: ela é de quem atende, não de
          onde o serviço acontece, e vinha do escopo ativo de qualquer jeito —
          um seletor que quase ninguém tinha motivo para mexer ocupava o lugar
          do campo que realmente importa. Trocar de cliente limpa endereço e
          equipamentos, porque os dois pertencem a ele.
        */}
        <ReferencePicker
          id="operation-customer"
          label="Cliente"
          placeholder="Sem cliente"
          value={form.customerId || undefined}
          selectedLabel={labels.customer}
          queryKey={schedulingReferencesService.keys.customers}
          fetcher={(search, options) =>
            schedulingReferencesService.customers(search, options)
          }
          toOption={(customer) => ({
            id: customer.id,
            label: customer.tradeName ?? customer.legalName,
          })}
          onChange={(customerId, label) => {
            edit({
              customerId: customerId ?? "",
              customerAddressId: "",
              assetIds: [],
            });
            setLabels((current) => ({ ...current, customer: label }));
          }}
        />

        <OperationAddressField
          customerId={form.customerId}
          value={form.customerAddressId}
          onChange={(customerAddressId) => edit({ customerAddressId })}
        />

        <div className="space-y-2">
          <Label htmlFor="operation-sector">Setor</Label>
          <Input
            id="operation-sector"
            value={form.sector}
            onChange={(event) => edit({ sector: event.target.value })}
            placeholder="Auditório, Sala 2, Cozinha…"
            maxLength={120}
          />
          <p className="text-xs text-muted-foreground">
            Opcional — o ponto exato dentro do endereço.
          </p>
        </div>

        {/*
          A liberação do valor para quem está em campo.

          Fica junto do que descreve o atendimento, e não numa aba de
          configurações: é uma decisão por atendimento, tomada no mesmo
          momento em que se escolhe quem vai e para onde.

          O número não é digitado aqui — ele é o total do orçamento vinculado.
          Este campo decide quem o vê, e o texto abaixo diz isso para que
          ninguém procure onde preencher o valor.
        */}
        <div className="sm:col-span-2">
          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id="operation-amount-visible"
              checked={form.amountVisibleInField}
              onCheckedChange={(checked) =>
                edit({ amountVisibleInField: checked === true })
              }
            />
            <div className="space-y-1">
              <Label
                htmlFor="operation-amount-visible"
                className="cursor-pointer"
              >
                Mostrar o valor ao técnico em campo
              </Label>
              <p className="text-xs text-muted-foreground">
                Exibe no aplicativo o total do orçamento vinculado a este
                atendimento. Sem orçamento, não há valor a mostrar.
              </p>
            </div>
          </div>
        </div>

        <div className="sm:col-span-2">
          <OperationEquipmentField
            customerId={form.customerId}
            selectedIds={form.assetIds}
            onChange={(assetIds) => edit({ assetIds: [...assetIds] })}
          />
        </div>

        {/*
          Quem executa e quem acompanha.

          Os dois campos existem no contrato desde sempre e nenhuma tela os
          enviava: o atendimento nascia sem dono, e atribuir exigia abrir a
          operação depois de criada.
        */}
        <div className="sm:col-span-2">
          <TechnicianAssignment
            businessUnitId={form.businessUnitId}
            /* O que está gravado, para a tela avisar o que não dá para desfazer. */
            persistedResponsibleId={editing?.responsibleFieldTechnicianId ?? ""}
            responsibleId={form.responsibleId}
            auxiliaryIds={form.auxiliaryIds}
            onChange={(patch) => edit(patch)}
          />
        </div>

        {/*
          O checklist entra pelo tipo, e só na criação.

          Numa operação que já existe o checklist já foi iniciado (ou
          deliberadamente não foi): oferecer o campo aqui prometeria trocar
          um roteiro que pode já ter respostas.
        */}
        {!editing ? (
          <div className="sm:col-span-2">
            <OperationChecklistField
              kind={(form.kind || null) as OperationKind | null}
              extras={form.checklistExtras}
              onChangeExtras={(items) => edit({ checklistExtras: [...items] })}
              onTemplateChange={setChecklistTemplateId}
            />
          </div>
        ) : null}

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="operation-description">Descrição</Label>
          <Textarea
            id="operation-description"
            rows={3}
            value={form.description}
            onChange={(event) => edit({ description: event.target.value })}
          />
        </div>
      </div>

      <MutationError error={mutation.error ?? erroDeEquipe} />

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          onClick={submit}
          disabled={!valid || mutation.isPending || equipePendente}
        >
          {mutation.isPending || equipePendente
            ? "Salvando…"
            : editing
              ? "Salvar alterações"
              : "Criar operação"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * Código sugerido: prefixo, o dia e um sufixo aleatório.
 *
 * O sufixo era `getTime() % 1000` — o milissegundo dentro do segundo. São mil
 * valores por dia, e o aniversário cobra cedo: por volta da vigésima terceira
 * ordem do dia a chance de repetir passa de 20%, e o servidor responde 409
 * "conflito nos dados" sem dizer qual campo mudar. Seis dígitos sorteados
 * empurram isso para além de mil ordens por dia.
 *
 * Continua sendo uma **sugestão**: o campo é editável, e quem numera por
 * contrato próprio sobrescreve.
 */
function suggestedCode(): string {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const [sorteado] = crypto.getRandomValues(new Uint32Array(1));
  const suffix = String(sorteado % 1_000_000).padStart(6, "0");
  return `OS-${stamp}-${suffix}`;
}

function toLocalInput(iso: string | null, timeZone: string): string {
  if (!iso) return "";
  const parts = zonedParts(new Date(iso), timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

function toInstant(local: string, timeZone: string): string | undefined {
  if (!local) return undefined;
  const [date, time] = local.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = (time ?? "00:00").split(":").map(Number);
  return instantFromZoned(
    { year, month, day, hour, minute },
    timeZone,
  ).toISOString();
}

function initialState(
  editing: OperationListItem | null,
  activeUnitId: string | null,
  units: readonly { id: string; isPrimary: boolean }[],
  timeZone: string,
  prefill?: OperationPrefill,
): FormState {
  if (editing) {
    return {
      businessUnitId: editing.businessUnitId,
      code: editing.code,
      kind: editing.kind,
      title: editing.title,
      description: editing.description ?? "",
      priority: editing.priority,
      startLocal: toLocalInput(editing.scheduledStart, timeZone),
      checklistExtras: [],
      responsibleId: editing.responsibleFieldTechnicianId ?? "",
      /// A atribuição carrega `userId`; o `user` aninhado é só para exibir.
      auxiliaryIds: (editing.auxiliaryTechnicians ?? []).map(
        (item) => item.userId,
      ),
      customerId: editing.customerId ?? "",
      assetIds: (editing.assets ?? []).map((equipamento) => equipamento.id),
      customerAddressId: editing.customerAddressId ?? "",
      sector: editing.sector ?? "",
      amountVisibleInField: editing.amountVisibleInField ?? false,
    };
  }

  const fallbackUnit =
    activeUnitId ??
    units.find((unit) => unit.isPrimary)?.id ??
    units[0]?.id ??
    "";

  return {
    businessUnitId: prefill?.businessUnitId || fallbackUnit,
    code: suggestedCode(),
    kind: OperationKind.MAINTENANCE,
    title: prefill?.title ?? "",
    description: "",
    priority: OperationPriority.NORMAL,
    /**
     * Data em branco de propósito.
     *
     * A preparação sabe **o que** será atendido, não **quando**. Sugerir
     * "agora" faria a etiqueta parecer um comando de início — exatamente o que
     * o domínio recusa.
     */
    startLocal: "",
    responsibleId: "",
    auxiliaryIds: [],
    checklistExtras: [],
    customerId: prefill?.customerId ?? "",
    assetIds: prefill?.assetId ? [prefill.assetId] : [],
    customerAddressId: "",
    sector: "",
    /* Desmarcado ao criar: liberar o valor combinado com o cliente é um ato
       consciente, não o que acontece quando ninguém olha o campo. */
    amountVisibleInField: false,
  };
}

/**
 * O corpo da requisição.
 *
 * ## A atribuição só viaja na criação
 *
 * `POST /operations` aceita responsável e auxiliares; `PATCH /operations/:id`
 * **recusa** — e o 400 era literal: "use os comandos explícitos para trocar os
 * técnicos do atendimento". O motivo é bom: trocar o responsável retira o escolhido
 * dos auxiliares, atualiza as alocações do evento na agenda, grava histórico e
 * registra participação. Um `PATCH` silencioso mudaria a coluna e deixaria o resto.
 *
 * Então na edição os dois campos ficam fora do corpo, e a mudança de equipe vai
 * pelas portas dela — ver `operation-assignment-commands`.
 */
function buildPayload(
  form: FormState,
  timeZone: string,
  modo: "criar" | "editar",
): CreateOperationInput {
  return {
    businessUnitId: form.businessUnitId,
    code: form.code.trim(),
    kind: form.kind as CreateOperationInput["kind"],
    title: form.title.trim(),
    description: form.description.trim() || undefined,
    priority: form.priority as CreateOperationInput["priority"],
    scheduledStart: toInstant(form.startLocal, timeZone),
    ...(modo === "criar"
      ? {
          responsibleFieldTechnicianId: form.responsibleId || undefined,
          auxiliaryTechnicianIds:
            form.auxiliaryIds.length > 0 ? form.auxiliaryIds : undefined,
        }
      : {}),
    customerId: form.customerId || undefined,
    assetIds: form.assetIds.length > 0 ? form.assetIds : undefined,
    customerAddressId: form.customerAddressId || undefined,
    sector: form.sector.trim() || undefined,
    amountVisibleInField: form.amountVisibleInField,
  };
}

/* ------------------------------------------------------------------ */
/* Atribuição                                                          */
/* ------------------------------------------------------------------ */

/**
 * O responsável e os auxiliares do atendimento.
 *
 * ## Os dois papéis não são o mesmo com nomes diferentes
 *
 * O **responsável** executa: inicia, responde o checklist, registra
 * evidência, conclui e assina. O **auxiliar** acompanha: no aplicativo de
 * campo ele lê o atendimento e os documentos já emitidos, e não executa nada.
 *
 * Quem garante isso é o servidor, em `MobileFieldOperationService.actions` —
 * a lista de ações permitidas é dele. Este formulário só declara quem é quem.
 *
 * ## Por que uma pessoa não pode ser as duas coisas
 *
 * Estar nas duas listas tornaria a pergunta "esta pessoa pode concluir?"
 * dependente da ordem em que o servidor olhasse as listas. Quem é escolhido
 * como responsável some das opções de auxiliar, e vice-versa.
 */
function TechnicianAssignment({
  businessUnitId,
  persistedResponsibleId = "",
  responsibleId,
  auxiliaryIds,
  onChange,
}: {
  /** O responsável já gravado. Vazio na criação, onde não há o que desfazer. */
  persistedResponsibleId?: string;
  /// A unidade do atendimento, não a do contexto: é por ela que o servidor
  /// confere a atribuição, e é dela que as duas listas têm de sair.
  businessUnitId: string;
  responsibleId: string;
  auxiliaryIds: string[];
  onChange: (patch: {
    responsibleId?: string;
    auxiliaryIds?: string[];
  }) => void;
}) {
  /**
   * Duas listas, porque são duas perguntas.
   *
   * Executar pede designação profissional; acompanhar pede vínculo com acesso ao
   * aplicativo. Os dois campos liam a lista de técnicos, e o resultado era que
   * **ninguém com o papel "Auxiliar técnico" podia ser auxiliar** — ele não tem
   * perfil profissional, por não assinar nada, e por isso não aparecia.
   *
   * ## Por que a unidade entra na consulta
   *
   * `validateTechnicianAssignments` confere a elegibilidade **na unidade do
   * atendimento**. Sem o recorte aqui, o formulário oferecia o elenco da
   * organização inteira e o servidor recusava a escolha no envio — a pessoa
   * perdia o preenchimento por um erro que a tela ajudou a cometer.
   */
  const semUnidade = !businessUnitId;
  const scope = businessUnitId ? { businessUnitId } : undefined;
  const technicians = useFieldTechnicians(scope, Boolean(businessUnitId));
  const assistants = useFieldAssistants(scope, Boolean(businessUnitId));
  const pessoas = technicians.data ?? [];
  const acompanhantes = assistants.data ?? [];

  const nomeDe = (id: string) =>
    [...pessoas, ...acompanhantes].find((pessoa) => pessoa.id === id)?.name ??
    id;

  const disponiveisComoAuxiliar = acompanhantes.filter(
    (pessoa) =>
      pessoa.id !== responsibleId && !auxiliaryIds.includes(pessoa.id),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        {/*
          "Técnico Operacional", e não "Técnico responsável".

          O produto usava "Técnico responsável" aqui e "Responsável Técnico" no
          PMOC — as mesmas palavras em ordens diferentes, para coisas opostas: um
          executa no cliente, o outro responde pelo contrato e assina o documento
          com a credencial que a norma exige. O rótulo vem do registry, que é onde
          os dois papéis têm nome.
        */}
        <Label htmlFor="operation-responsible">
          {PROFESSIONAL_ROLES.FIELD_TECHNICIAN.label}
        </Label>
        <Select
          value={responsibleId || SEM_RESPONSAVEL}
          onValueChange={(value) =>
            onChange({
              responsibleId: value === SEM_RESPONSAVEL ? "" : value,
              /// Se a pessoa já era auxiliar, deixa de ser ao virar
              /// responsável: os dois papéis se excluem.
              auxiliaryIds: auxiliaryIds.filter((id) => id !== value),
            })
          }
        >
          <SelectTrigger id="operation-responsible">
            <SelectValue placeholder="Definir depois" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_RESPONSAVEL}>Definir depois</SelectItem>
            {pessoas
              .filter((pessoa) => !auxiliaryIds.includes(pessoa.id))
              .map((pessoa) => (
                <SelectItem key={pessoa.id} value={pessoa.id}>
                  {pessoa.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {/*
          A lista vazia se explica.

          Era isto que escondia o problema: o seletor abria sem ninguém dentro,
          idêntico a "ainda não escolhi", e nada na tela dizia que faltava
          habilitar o perfil profissional da pessoa. Quem cadastrou o técnico
          cinco minutos antes não tinha como adivinhar.
        */}
        {/*
          Tirar o responsável não é possível, e a tela diz isso.

          Os comandos de atribuição exigem um `userId`: a API não tem "desatribuir
          responsável", porque atendimento sem dono é o estado que a atribuição existe
          para evitar. Deixar o campo esvaziar em silêncio faria quem salvou acreditar
          que tirou — e o técnico continuaria recebendo no celular.
        */}
        {persistedResponsibleId && !responsibleId ? (
          <p className="text-xs text-warning">
            Este atendimento já tem responsável, e ele não pode ficar sem um.
            Para mudar, escolha outra pessoa; deixar em branco mantém quem está.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {semUnidade
              ? "Escolha a unidade de negócio para ver quem atende nela."
              : technicians.isPending
                ? "Carregando quem atende nesta unidade…"
                : pessoas.length === 0
                  ? "Ninguém desta unidade tem o perfil de técnico de campo. Habilite em Equipe › o membro › Perfil profissional."
                  : "Executa o atendimento no aplicativo de campo."}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="operation-auxiliary">Auxiliares</Label>
        <Select
          value=""
          onValueChange={(value) =>
            onChange({ auxiliaryIds: [...auxiliaryIds, value] })
          }
          disabled={disponiveisComoAuxiliar.length === 0}
        >
          <SelectTrigger id="operation-auxiliary">
            <SelectValue placeholder="Adicionar auxiliar" />
          </SelectTrigger>
          <SelectContent>
            {disponiveisComoAuxiliar.map((pessoa) => (
              <SelectItem key={pessoa.id} value={pessoa.id}>
                {pessoa.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {auxiliaryIds.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {auxiliaryIds.map((id) => (
              <li key={id}>
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-strong px-2 py-0.5 text-xs">
                  {nomeDe(id)}
                  <button
                    type="button"
                    aria-label={`Remover ${nomeDe(id)}`}
                    onClick={() =>
                      onChange({
                        auxiliaryIds: auxiliaryIds.filter(
                          (item) => item !== id,
                        ),
                      })
                    }
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {semUnidade
            ? "Escolha a unidade de negócio para ver quem pode acompanhar."
            : assistants.isPending
              ? "Carregando quem pode acompanhar…"
              : acompanhantes.length === 0
                ? "Ninguém desta unidade tem acesso ao aplicativo de campo."
                : "Acompanham: leem o atendimento e os documentos emitidos, sem executar."}
        </p>
      </div>
    </div>
  );
}
