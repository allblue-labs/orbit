"use client";

/**
 * Criação e edição de lançamento manual.
 *
 * Escreve em `POST /financial/entries` e `PATCH /financial/entries/:id`, e
 * oferece exatamente o que os DTOs aceitam.
 *
 * ## O que o formulário de edição não tem
 *
 * Sentido, situação, procedência e unidade **não aparecem na edição**, porque
 * `UpdateFinancialEntryDto` não os aceita. Não é limitação da tela: mudar o
 * status por um `PATCH` silencioso apagaria quem confirmou e quando, que é
 * justamente o que a auditoria financeira precisa saber. Confirmar e cancelar
 * são ações próprias.
 *
 * ## Origem automática não chega aqui
 *
 * Um lançamento de recibo tem `editable: false`, e a listagem não oferece o
 * botão. Se chegasse, o servidor responderia 409 — e a mensagem apareceria
 * como veio, sem tradução inventada.
 *
 * ## Nada é calculado
 *
 * O valor é o que a pessoa digitou. Não há total, imposto, desconto nem
 * conversão de moeda: `currency` acompanha o padrão da organização, e o
 * backend só aceita os códigos que declara suportar.
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
import {
  useCreateFinancialEntry,
  useFinancialCategories,
  useUpdateFinancialEntry,
} from "@/hooks/financial/use-financial";
import { useActiveScope } from "@/providers/use-active-scope";
import {
  FINANCIAL_TYPE_LABELS,
  type CreateFinancialEntryInput,
  type FinancialEntry,
  type FinancialEntryType,
  type UpdateFinancialEntryInput,
} from "@/types/financial";

/** "Sem categoria" precisa de um valor real no `Select` do Radix. */
const NONE = "__none__";

interface FormState {
  type: FinancialEntryType;
  amount: string;
  description: string;
  categoryId: string;
  competenceDate: string;
  dueDate: string;
  businessUnitId: string;
  notes: string;
  confirmed: boolean;
}

/** Hoje em `YYYY-MM-DD`, no fuso de quem está lançando. */
function today(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function initialState(
  entry: FinancialEntry | null,
  defaultType: FinancialEntryType,
  defaultUnit: string,
): FormState {
  return {
    type: entry?.type ?? defaultType,
    amount: entry?.amount ?? "",
    description: entry?.description ?? "",
    categoryId: entry?.category?.id ?? "",
    competenceDate: entry?.competenceDate ?? today(),
    dueDate: entry?.dueDate ?? "",
    businessUnitId: entry?.businessUnit.id ?? defaultUnit,
    notes: entry?.notes ?? "",
    confirmed: false,
  };
}

const optional = (value: string): string | undefined =>
  value.trim() ? value.trim() : undefined;

/**
 * Texto → número, só na fronteira com a API.
 *
 * `@IsNumber({ maxDecimalPlaces: 2 })` do lado de lá. Vírgula vira ponto
 * porque é assim que se digita valor em português; vazio vira `NaN` e o botão
 * fica desabilitado antes de a requisição sair.
 */
function toAmount(value: string): number {
  return Number(value.trim().replace(/\./g, "").replace(",", "."));
}

export function FinancialEntryFormDialog({
  open,
  onOpenChange,
  editing = null,
  defaultType = "INCOME",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: FinancialEntry | null;
  defaultType?: FinancialEntryType;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <Body
          key={editing?.id ?? `new:${defaultType}`}
          editing={editing}
          defaultType={defaultType}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  editing,
  defaultType,
  onOpenChange,
}: {
  editing: FinancialEntry | null;
  defaultType: FinancialEntryType;
  onOpenChange: (open: boolean) => void;
}) {
  const { businessUnits, businessUnitId } = useActiveScope();
  const [form, setForm] = useState<FormState>(() =>
    initialState(editing, defaultType, businessUnitId ?? ""),
  );

  /**
   * As categorias são filtradas pelo **lado** escolhido.
   *
   * O servidor recusa categoria de receita em despesa (`400`). Oferecer a
   * lista inteira convidaria ao erro — e a recusa viria depois de a pessoa já
   * ter preenchido o resto.
   */
  const categories = useFinancialCategories({ type: form.type });

  const create = useCreateFinancialEntry();
  const update = useUpdateFinancialEntry();
  const mutation = editing ? update : create;

  const set = <TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const amount = toAmount(form.amount);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const done = () => onOpenChange(false);

    if (editing) {
      const input: UpdateFinancialEntryInput = {
        amount,
        description: form.description.trim(),
        notes: optional(form.notes),
        competenceDate: form.competenceDate,
        dueDate: optional(form.dueDate),
        categoryId: optional(form.categoryId),
      };
      update.mutate({ id: editing.id, input }, { onSuccess: done });
      return;
    }

    const input: CreateFinancialEntryInput = {
      type: form.type,
      status: form.confirmed ? "CONFIRMED" : "PENDING",
      amount,
      description: form.description.trim(),
      notes: optional(form.notes),
      competenceDate: form.competenceDate,
      dueDate: optional(form.dueDate),
      categoryId: optional(form.categoryId),
      businessUnitId: optional(form.businessUnitId),
    };
    create.mutate(input, { onSuccess: done });
  };

  const incomplete =
    !Number.isFinite(amount) ||
    amount <= 0 ||
    form.description.trim().length < 2 ||
    !form.competenceDate ||
    (!editing && !form.businessUnitId);

  const noun = FINANCIAL_TYPE_LABELS[form.type]?.toLowerCase() ?? "lançamento";

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {editing ? `Editar ${noun}` : `Nova ${noun}`}
        </DialogTitle>
        <DialogDescription>
          O valor é registrado como foi informado. Nenhum imposto, desconto ou
          total é calculado aqui.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        {editing ? null : (
          <Field label="Sentido" htmlFor="financial-type">
            <Select
              value={form.type}
              onValueChange={(value) => {
                /** Trocar de lado invalida a categoria escolhida. */
                setForm((current) => ({
                  ...current,
                  type: value as FinancialEntryType,
                  categoryId: "",
                }));
              }}
            >
              <SelectTrigger id="financial-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INCOME">
                  {FINANCIAL_TYPE_LABELS.INCOME}
                </SelectItem>
                <SelectItem value="EXPENSE">
                  {FINANCIAL_TYPE_LABELS.EXPENSE}
                </SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field
          label="Valor"
          htmlFor="financial-amount"
          hint="Sempre positivo — o sentido é dado pelo campo acima."
        >
          <Input
            id="financial-amount"
            inputMode="decimal"
            value={form.amount}
            onChange={(event) => set("amount", event.target.value)}
            placeholder="0,00"
            required
          />
        </Field>

        <Field
          label="Descrição"
          htmlFor="financial-description"
          className="sm:col-span-2"
        >
          <Input
            id="financial-description"
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
            maxLength={255}
            placeholder="Ex.: Manutenção preventiva — Ed. Aurora"
            required
          />
        </Field>

        <Field
          label="Competência"
          htmlFor="financial-competence"
          hint="Quando o fato aconteceu, não quando foi digitado."
        >
          <Input
            id="financial-competence"
            type="date"
            value={form.competenceDate}
            onChange={(event) => set("competenceDate", event.target.value)}
            required
          />
        </Field>

        <Field
          label="Vencimento"
          htmlFor="financial-due"
          hint="Opcional. O lançamento é marcado como vencido depois desta data."
        >
          <Input
            id="financial-due"
            type="date"
            value={form.dueDate}
            onChange={(event) => set("dueDate", event.target.value)}
          />
        </Field>

        <Field label="Categoria" htmlFor="financial-category">
          <Select
            value={form.categoryId || NONE}
            onValueChange={(value) =>
              set("categoryId", value === NONE ? "" : value)
            }
          >
            <SelectTrigger id="financial-category">
              <SelectValue placeholder="Sem categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>Sem categoria</SelectItem>
              {(categories.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {editing ? null : (
          <Field
            label="Organização"
            htmlFor="financial-unit"
            hint="Dinheiro é contado por organização, e não muda depois."
          >
            <Select
              value={form.businessUnitId}
              onValueChange={(value) => set("businessUnitId", value)}
            >
              <SelectTrigger id="financial-unit">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {businessUnits.map((unit) => (
                  <SelectItem key={unit.id} value={unit.id}>
                    {unit.tradeName ?? unit.legalName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Field
          label="Observações"
          htmlFor="financial-notes"
          className="sm:col-span-2"
        >
          <Textarea
            id="financial-notes"
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
            maxLength={2000}
            rows={3}
          />
        </Field>
      </div>

      {editing ? null : (
        /**
         * Já recebido / já pago.
         *
         * O contrato aceita `PENDING` ou `CONFIRMED` na criação — e só esses
         * dois. Nascer cancelado seria lançamento que nunca precisou existir.
         */
        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--color-primary)]"
            checked={form.confirmed}
            onChange={(event) => set("confirmed", event.target.checked)}
          />
          <span>
            <span className="font-medium">
              {form.type === "INCOME" ? "Já recebido" : "Já pago"}
            </span>
            <span className="block text-xs text-muted-foreground">
              Entra como realizado. Sem marcar, fica previsto até alguém
              confirmar.
            </span>
          </span>
        </label>
      )}

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || mutation.isPending}>
          {mutation.isPending ? "Salvando…" : editing ? "Salvar" : "Lançar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
