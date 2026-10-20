"use client";

/**
 * O editor declarativo de uma regra.
 *
 * Três blocos, na ordem em que a frase é lida: **quando**, **se**, **então**.
 * Cada um oferece exatamente o que o catálogo do servidor publicou — gatilhos,
 * operadores, tipos de ação, unidades de prazo e, quando o campo tem conjunto
 * fechado, os valores aceitos.
 *
 * ## O que este formulário não faz
 *
 * Não avalia condição, não calcula prazo, não decide se uma ação é executável
 * e não valida combinação. Tudo isso é do servidor, e ele recusa com a
 * mensagem dele — que aparece aqui, inteira. O botão só fica inerte pelo que é
 * **forma**: sem nome, sem gatilho, sem ação.
 *
 * ## O prazo viaja como veio
 *
 * `{ amount: 6, unit: "MONTHS" }`. Nunca convertido para dias: seis meses de
 * calendário depois de 31 de agosto é 28 de fevereiro, e o `Date` do navegador
 * não sabe disso — o Postgres sabe. A conta é do servidor, e o formulário não
 * tem opinião sobre ela.
 *
 * ## Editar não troca o gatilho
 *
 * O seletor fica travado na edição. O contrato não aceita `trigger` no `PATCH`,
 * e a razão é boa: seria outra regra, com o histórico de execuções da anterior
 * pendurado nela. Quem errou duplica e ajusta.
 */
import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useOrganizationMembers } from "@/hooks/organization/use-organization";
import {
  useCreateAutomationRule,
  useUpdateAutomationRule,
} from "@/hooks/automations/use-automations";
import {
  AUTOMATION_CONFIG_LABELS,
  AUTOMATION_DELAY_UNIT_LABELS,
  AUTOMATION_NOTIFICATION_TARGET_LABELS,
  AUTOMATION_OPERATOR_LABELS,
  automationFieldLabel,
  type AutomationActionInput,
  type AutomationCatalog,
  type AutomationConditionInput,
  type AutomationConfigField,
  type AutomationRule,
} from "@/types/automations";
import { FREE_FIELD_HINTS, fieldOptions, type ScopeUnit } from "./automation-fields";
import { AutomationSentence } from "./automation-sentence";

const ORGANIZATION_SCOPE = "__organization__";

interface DraftCondition extends AutomationConditionInput {
  /** Identidade local só para a lista do formulário — não viaja. */
  key: string;
}

interface DraftAction extends AutomationActionInput {
  key: string;
}

let sequence = 0;
const nextKey = (): string => `draft-${(sequence += 1)}`;

export function AutomationFormDialog({
  catalog,
  rule,
  units,
  open,
  onOpenChange,
}: {
  catalog: AutomationCatalog;
  /** Ausente = criação. Presente = edição, com o gatilho travado. */
  rule?: AutomationRule;
  units: readonly ScopeUnit[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <Body
          key={rule?.id ?? "new"}
          catalog={catalog}
          rule={rule}
          units={units}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  catalog,
  rule,
  units,
  onOpenChange,
}: {
  catalog: AutomationCatalog;
  rule?: AutomationRule;
  units: readonly ScopeUnit[];
  onOpenChange: (open: boolean) => void;
}) {
  const isEdit = Boolean(rule);
  const create = useCreateAutomationRule();
  const update = useUpdateAutomationRule(rule?.id ?? "");
  const mutation = isEdit ? update : create;

  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [trigger, setTrigger] = useState(rule?.trigger ?? "");
  const [scope, setScope] = useState(
    rule?.businessUnit?.id ?? ORGANIZATION_SCOPE,
  );
  const [conditions, setConditions] = useState<DraftCondition[]>(() =>
    (rule?.conditions ?? []).map((condition) => ({
      key: nextKey(),
      field: condition.field,
      operator: condition.operator,
      value: Array.isArray(condition.value)
        ? [...(condition.value as readonly string[])]
        : (condition.value as string | undefined),
    })),
  );
  const [actions, setActions] = useState<DraftAction[]>(() =>
    (rule?.actions ?? []).map((action) => ({
      key: nextKey(),
      type: action.type,
      ...(action.delay ? { delay: { ...action.delay } } : {}),
      config: { ...action.config },
    })),
  );

  const definition = catalog.triggers.find((item) => item.type === trigger);
  const entityType = definition?.entityType ?? "";

  /**
   * Trocar o gatilho descarta as condições.
   *
   * Os campos disponíveis são outros, e o servidor recusaria a regra inteira
   * por causa de uma condição que sobrou. Feito na troca, não num efeito: o
   * descarte é consequência do ato de quem escolheu, e não de o estado ter
   * mudado — reagir depois faria a lista piscar preenchida antes de esvaziar.
   */
  const changeTrigger = (next: string) => {
    setTrigger(next);
    setConditions([]);
  };

  const availableActions = useMemo(
    () => catalog.actions.filter((action) => action.available),
    [catalog.actions],
  );

  const incomplete =
    name.trim().length < 3 || !trigger || actions.length === 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const done = () => onOpenChange(false);

    const payloadConditions = conditions.map(({ key: _key, ...rest }) => rest);
    const payloadActions = actions.map(({ key: _key, ...rest }) => rest);

    if (isEdit) {
      update.mutate(
        {
          name: name.trim(),
          description: description.trim() || undefined,
          conditions: payloadConditions,
          actions: payloadActions,
        },
        { onSuccess: done },
      );
      return;
    }

    create.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        trigger,
        businessUnitId: scope === ORGANIZATION_SCOPE ? undefined : scope,
        conditions: payloadConditions,
        actions: payloadActions,
      },
      { onSuccess: done },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-6">
      <DialogHeader>
        <DialogTitle>
          {isEdit ? "Editar automação" : "Nova automação"}
        </DialogTitle>
        <DialogDescription>
          Uma automação é uma frase: quando algo acontece, se as condições
          valem, então o Orbit faz o que você combinou.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="automation-name">Nome</Label>
          <Input
            id="automation-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={180}
            placeholder="Ex.: Preventiva semestral"
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="automation-description">Descrição (opcional)</Label>
          <Textarea
            id="automation-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            maxLength={2000}
            rows={2}
            placeholder="Para que serve esta regra."
          />
        </div>
      </div>

      <Separator />

      {/* -------------------------------------------------------- */}
      {/* Quando                                                     */}
      {/* -------------------------------------------------------- */}

      <section className="space-y-3">
        <SectionTitle keyword="Quando" hint="O fato que dispara a regra." />

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="automation-trigger">Acontecimento</Label>
            <Select
              value={trigger}
              onValueChange={changeTrigger}
              disabled={isEdit}
            >
              <SelectTrigger id="automation-trigger">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {catalog.triggers.map((item) => (
                  <SelectItem key={item.type} value={item.type}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isEdit ? (
              <p className="text-xs text-muted-foreground">
                O acontecimento não muda depois de criada — o histórico de
                execuções pertence a ele. Para trocar, duplique a regra.
              </p>
            ) : definition ? (
              <p className="text-xs text-muted-foreground">
                {definition.description}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="automation-scope">Onde vale</Label>
            <Select value={scope} onValueChange={setScope} disabled={isEdit}>
              <SelectTrigger id="automation-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ORGANIZATION_SCOPE}>
                  Toda a organização
                </SelectItem>
                {units.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {isEdit
                ? "O alcance é definido na criação."
                : "Presa a uma unidade, a regra ignora eventos das outras."}
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------- */}
      {/* Se                                                         */}
      {/* -------------------------------------------------------- */}

      <section className="space-y-3">
        <SectionTitle
          keyword="Se"
          hint="Todas as condições precisam valer. Sem condição, a regra vale sempre."
        />

        {!definition ? (
          <p className="text-sm text-muted-foreground">
            Escolha o acontecimento para ver o que pode ser comparado.
          </p>
        ) : (
          <div className="space-y-3">
            {conditions.map((condition, index) => (
              <ConditionRow
                key={condition.key}
                condition={condition}
                fields={definition.fields}
                entityType={entityType}
                operators={catalog.operators}
                units={units}
                onChange={(next) =>
                  setConditions((current) =>
                    current.map((item, position) =>
                      position === index ? { ...next, key: item.key } : item,
                    ),
                  )
                }
                onRemove={() =>
                  setConditions((current) =>
                    current.filter((_, position) => position !== index),
                  )
                }
              />
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={conditions.length >= 10}
              onClick={() =>
                setConditions((current) => [
                  ...current,
                  {
                    key: nextKey(),
                    field: definition.fields[0] ?? "",
                    operator: "equals",
                    value: "",
                  },
                ])
              }
            >
              <Plus className="size-4" />
              Adicionar condição
            </Button>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- */}
      {/* Então                                                      */}
      {/* -------------------------------------------------------- */}

      <section className="space-y-3">
        <SectionTitle keyword="Então" hint="O que o Orbit faz." />

        <div className="space-y-3">
          {actions.map((action, index) => (
            <ActionRow
              key={action.key}
              action={action}
              catalog={catalog}
              onChange={(next) =>
                setActions((current) =>
                  current.map((item, position) =>
                    position === index ? { ...next, key: item.key } : item,
                  ),
                )
              }
              onRemove={() =>
                setActions((current) =>
                  current.filter((_, position) => position !== index),
                )
              }
            />
          ))}

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actions.length >= 5 || availableActions.length === 0}
            onClick={() =>
              setActions((current) => [
                ...current,
                {
                  key: nextKey(),
                  type: availableActions[0]?.type ?? "CREATE_REMINDER",
                  config: {} as Record<string, unknown>,
                } satisfies DraftAction,
              ])
            }
          >
            <Plus className="size-4" />
            Adicionar ação
          </Button>
        </div>
      </section>

      {definition && actions.length > 0 ? (
        <div className="rounded-lg border border-border bg-surface-strong/40 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Como esta regra vai ser lida
          </p>
          <AutomationSentence
            rule={{
              trigger,
              triggerLabel: definition.label,
              conditions: conditions.map(({ key: _key, ...rest }) => rest),
              actions: actions.map(({ key, ...rest }) => ({
                id: key,
                type: rest.type,
                delay: rest.delay ?? null,
                config: rest.config,
                available: true,
              })),
            }}
            entityType={entityType}
            actionDefinitions={catalog.actions}
            units={units}
          />
        </div>
      ) : null}

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={mutation.isPending}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || mutation.isPending}>
          {mutation.isPending
            ? "Salvando…"
            : isEdit
              ? "Salvar"
              : "Criar automação"}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Blocos                                                              */
/* ------------------------------------------------------------------ */

function SectionTitle({ keyword, hint }: { keyword: string; hint: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
        {keyword}
      </p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function ConditionRow({
  condition,
  fields,
  entityType,
  operators,
  units,
  onChange,
  onRemove,
}: {
  condition: AutomationConditionInput;
  fields: readonly string[];
  entityType: string;
  operators: readonly string[];
  units: readonly ScopeUnit[];
  onChange: (next: AutomationConditionInput) => void;
  onRemove: () => void;
}) {
  const catalogValues = fieldOptions(entityType, condition.field, units);
  const isList = condition.operator === "in";
  const needsValue = condition.operator !== "exists";
  const selected = Array.isArray(condition.value)
    ? condition.value
    : condition.value
      ? [String(condition.value)]
      : [];

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <Label>Campo</Label>
          <Select
            value={condition.field}
            onValueChange={(field) =>
              /** Campo novo, valor descartado: o vocabulário mudou. */
              onChange({ ...condition, field, value: isList ? [] : "" })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {fields.map((field) => (
                <SelectItem key={field} value={field}>
                  {automationFieldLabel(field)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Comparação</Label>
          <Select
            value={condition.operator}
            onValueChange={(operator) =>
              onChange({
                ...condition,
                operator: operator as AutomationConditionInput["operator"],
                value:
                  operator === "in"
                    ? selected
                    : operator === "exists"
                      ? undefined
                      : (selected[0] ?? ""),
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {operators.map((operator) => (
                <SelectItem key={operator} value={operator}>
                  {AUTOMATION_OPERATOR_LABELS[operator] ?? operator}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Remover condição"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {needsValue ? (
        <div className="mt-3 space-y-2">
          <Label>Valor</Label>
          {catalogValues ? (
            isList ? (
              <MultiSelect
                options={catalogValues.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={selected}
                onChange={(next) => onChange({ ...condition, value: next })}
                placeholder="Selecione um ou mais"
              />
            ) : (
              <Select
                value={selected[0] ?? ""}
                onValueChange={(value) => onChange({ ...condition, value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {catalogValues.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
          ) : (
            <>
              <Input
                value={isList ? selected.join(", ") : (selected[0] ?? "")}
                onChange={(event) =>
                  onChange({
                    ...condition,
                    value: isList
                      ? event.target.value
                          .split(",")
                          .map((part) => part.trim())
                          .filter(Boolean)
                      : event.target.value,
                  })
                }
                placeholder={isList ? "Valores separados por vírgula" : ""}
              />
              {FREE_FIELD_HINTS[condition.field] ? (
                <p className="text-xs text-muted-foreground">
                  {FREE_FIELD_HINTS[condition.field]}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Sem valor: a condição só pergunta se o campo veio preenchido.
        </p>
      )}
    </div>
  );
}

function ActionRow({
  action,
  catalog,
  onChange,
  onRemove,
}: {
  action: AutomationActionInput;
  catalog: AutomationCatalog;
  onChange: (next: AutomationActionInput) => void;
  onRemove: () => void;
}) {
  const definition = catalog.actions.find((item) => item.type === action.type);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <Label>Ação</Label>
          <Select
            value={action.type}
            onValueChange={(type) =>
              /** Ação nova, configuração nova: as chaves são outras. */
              onChange({
                type: type as AutomationActionInput["type"],
                config: {},
                ...(action.delay ? { delay: action.delay } : {}),
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {catalog.actions.map((item) => (
                <SelectItem
                  key={item.type}
                  value={item.type}
                  disabled={!item.available}
                >
                  {item.label}
                  {item.available ? "" : " — indisponível"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {definition ? (
            <p className="text-xs text-muted-foreground">
              {definition.description}
            </p>
          ) : null}
          {definition && !definition.available ? (
            <p className="text-xs text-warning">
              {definition.unavailableReason}
            </p>
          ) : null}
        </div>

        <div className="flex items-start pt-8">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemove}
            aria-label="Remover ação"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {definition ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {definition.config.map((field) => (
            <ConfigField
              key={field.key}
              field={field}
              value={action.config[field.key]}
              onChange={(value) =>
                onChange({
                  ...action,
                  config:
                    value === "" || value === undefined
                      ? omit(action.config, field.key)
                      : { ...action.config, [field.key]: value },
                })
              }
            />
          ))}
        </div>
      ) : null}

      <DelayField
        delay={action.delay}
        units={catalog.delayUnits}
        onChange={(delay) =>
          onChange(
            delay
              ? { ...action, delay }
              : { type: action.type, config: action.config },
          )
        }
      />
    </div>
  );
}

/** Remove uma chave sem deixar `undefined` no objeto que vai viajar. */
function omit(
  config: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const next = { ...config };
  delete next[key];
  return next;
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: AutomationConfigField;
  value: unknown;
  onChange: (value: string | number | undefined) => void;
}) {
  const label = AUTOMATION_CONFIG_LABELS[field.key] ?? field.key;
  const id = `automation-config-${field.key}`;
  const current = typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";

  /**
   * O destinatário é um membro da organização, escolhido numa lista.
   *
   * O backend confere a associação e recusa quem não for membro ativo; a lista
   * evita oferecer o que seria recusado — e evita pedir um identificador de
   * usuário digitado à mão.
   */
  if (field.key === "userId") {
    return <MemberField id={id} label={label} value={current} onChange={onChange} />;
  }

  /** Conjunto fechado publicado pelo servidor — nunca uma lista local. */
  if (field.options && field.options.length > 0) {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Select value={current} onValueChange={onChange}>
          <SelectTrigger id={id}>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {AUTOMATION_NOTIFICATION_TARGET_LABELS[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {field.required ? null : (
          <p className="text-xs text-muted-foreground">Opcional.</p>
        )}
      </div>
    );
  }

  if (field.key === "durationMinutes") {
    return (
      <div className="space-y-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          inputMode="numeric"
          value={current}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            onChange(
              event.target.value === ""
                ? undefined
                : Number.isFinite(parsed)
                  ? parsed
                  : undefined,
            );
          }}
          placeholder="60"
        />
        <p className="text-xs text-muted-foreground">{field.description}</p>
      </div>
    );
  }

  const isLong = field.key === "body" || field.key === "description";

  return (
    <div className={isLong ? "space-y-2 sm:col-span-2" : "space-y-2"}>
      <Label htmlFor={id}>
        {label}
        {field.required ? "" : " (opcional)"}
      </Label>
      {isLong ? (
        <Textarea
          id={id}
          rows={2}
          value={current}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <Input
          id={id}
          value={current}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      <p className="text-xs text-muted-foreground">{field.description}</p>
    </div>
  );
}

function MemberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string | undefined) => void;
}) {
  const members = useOrganizationMembers();

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue
            placeholder={members.isPending ? "Carregando…" : "Selecione"}
          />
        </SelectTrigger>
        <SelectContent>
          {(members.data?.data ?? []).map((member) => (
            <SelectItem key={member.userId} value={member.userId}>
              {member.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Só membros desta organização. Obrigatório quando o destinatário é uma
        pessoa específica.
      </p>
    </div>
  );
}

/**
 * O prazo.
 *
 * Valor e unidade, exatamente como o contrato espera. A unidade vem de
 * `catalog.delayUnits` — se o backend ganhar `YEARS`, ela aparece aqui sem
 * ninguém editar este arquivo.
 */
function DelayField({
  delay,
  units,
  onChange,
}: {
  delay: AutomationActionInput["delay"];
  units: readonly string[];
  onChange: (delay: AutomationActionInput["delay"]) => void;
}) {
  const enabled = Boolean(delay);

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-dashed border-border p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Aguardar antes de executar</p>
          <p className="text-xs text-muted-foreground">
            O prazo é contado a partir do acontecimento. Meses são
            meses de calendário.
          </p>
        </div>
        <Button
          type="button"
          variant={enabled ? "secondary" : "outline"}
          size="sm"
          onClick={() =>
            onChange(
              enabled
                ? undefined
                : {
                    amount: 1,
                    unit: (units[0] ??
                      "DAYS") as NonNullable<
                      AutomationActionInput["delay"]
                    >["unit"],
                  },
            )
          }
        >
          {enabled ? "Executar na hora" : "Definir prazo"}
        </Button>
      </div>

      {delay ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="automation-delay-amount">Quantidade</Label>
            <Input
              id="automation-delay-amount"
              inputMode="numeric"
              value={String(delay.amount)}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                onChange({
                  ...delay,
                  amount: Number.isFinite(parsed) && parsed > 0 ? parsed : 1,
                });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="automation-delay-unit">Unidade</Label>
            <Select
              value={delay.unit}
              onValueChange={(unit) =>
                onChange({
                  ...delay,
                  unit: unit as typeof delay.unit,
                })
              }
            >
              <SelectTrigger id="automation-delay-unit">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {units.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {AUTOMATION_DELAY_UNIT_LABELS[unit] ?? unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  );
}
