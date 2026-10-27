"use client";

/**
 * Criação e edição de equipamento.
 *
 * Escreve em `POST /assets` e `PATCH /assets/:id`. O formulário oferece
 * exatamente o que `CreateAssetDto` aceita — unidade, cliente, categoria,
 * nome, fabricante, modelo, série, identificador, datas, localização — e nada
 * além.
 *
 * ## O que não é decidido aqui
 *
 * - **Status na criação.** `CreateAssetDto` **não tem** o campo; só
 *   `UpdateAssetDto` o aceita. Quem define o estado inicial é o servidor, e o
 *   formulário não finge oferecer a escolha. Ativar e desativar existem depois,
 *   como ações próprias.
 * - **Unicidade do identificador.** O banco tem `@@unique` por organização; a
 *   tela não pré-verifica. Duplicidade volta como erro do servidor e aparece
 *   como veio — perguntar antes seria uma segunda fonte de verdade que pode
 *   estar desatualizada no instante seguinte.
 * - **`specifications`.** É JSON livre do tenant, sem esquema no contrato. O
 *   formulário não inventa campos para ele; o Workspace o exibe como
 *   especificação.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ReferencePicker } from "@/components/scheduling/reference-picker";
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
import { useCreateAsset, useUpdateAsset } from "@/hooks/assets/use-assets";
import { useActiveScope } from "@/providers/use-active-scope";
import { schedulingReferencesService } from "@/services/scheduling-references.service";
import { AssetCategory, AssetIdentifierType } from "@/types/contracts";
import {
  ASSET_LIMITS,
  type Asset,
  type CreateAssetInput,
  type UpdateAssetInput,
} from "@/types/assets";
import { ASSET_CATEGORY_LABELS } from "@/entities";

interface FormState {
  businessUnitId: string;
  customerId: string;
  category: AssetCategory;
  name: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  identifierType: string;
  identifier: string;
  installationAt: string;
  warrantyUntil: string;
  location: string;
}

/** `@db.Date` — o contrato guarda o dia, então o campo é `date`. */
const toDateInput = (value: string | null): string =>
  value ? value.slice(0, 10) : "";

function initialState(
  asset: Asset | null,
  defaults: { businessUnitId: string; customerId: string },
): FormState {
  return {
    businessUnitId: asset?.businessUnitId ?? defaults.businessUnitId,
    customerId: asset?.customerId ?? defaults.customerId,
    category: asset?.category ?? AssetCategory.EQUIPMENT,
    name: asset?.name ?? "",
    manufacturer: asset?.manufacturer ?? "",
    model: asset?.model ?? "",
    serialNumber: asset?.serialNumber ?? "",
    identifierType: asset?.identifierType ?? AssetIdentifierType.QR_CODE,
    identifier: asset?.identifier ?? "",
    installationAt: toDateInput(asset?.installationAt ?? null),
    warrantyUntil: toDateInput(asset?.warrantyUntil ?? null),
    location: asset?.location ?? "",
  };
}

/** Texto vazio não viaja: o DTO trata ausência e string vazia de formas diferentes. */
const optional = (value: string): string | undefined =>
  value.trim() ? value.trim() : undefined;

export function AssetFormDialog({
  open,
  onOpenChange,
  editing = null,
  /** Pré-vincula ao cliente quando o formulário abre de dentro dele. */
  customerId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Asset | null;
  customerId?: string;
  onSaved?: (asset: Asset) => void;
}) {
  const { businessUnitId, businessUnits } = useActiveScope();

  /**
   * O estado é recriado quando o diálogo abre, não a cada render.
   *
   * A chave do `Body` carrega o que o identifica — abrir para outro
   * equipamento monta um formulário novo, em vez de manter os valores do
   * anterior.
   */
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <Body
          key={editing?.id ?? `new:${customerId ?? ""}`}
          editing={editing}
          customerId={customerId}
          defaults={{
            businessUnitId:
              editing?.businessUnitId ??
              businessUnitId ??
              businessUnits[0]?.id ??
              "",
            customerId: editing?.customerId ?? customerId ?? "",
          }}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  editing,
  customerId,
  defaults,
  onOpenChange,
  onSaved,
}: {
  editing: Asset | null;
  customerId?: string;
  defaults: { businessUnitId: string; customerId: string };
  onOpenChange: (open: boolean) => void;
  onSaved?: (asset: Asset) => void;
}) {
  const { businessUnits } = useActiveScope();
  const [form, setForm] = useState<FormState>(() =>
    initialState(editing, defaults),
  );

  const create = useCreateAsset();
  const update = useUpdateAsset(editing?.id ?? "");
  const mutation = editing ? update : create;

  const set = <TKey extends keyof FormState>(
    key: TKey,
    value: FormState[TKey],
  ) => setForm((current) => ({ ...current, [key]: value }));

  /**
   * O identificador sai do formulário na criação: é o servidor que o gera.
   *
   * Todo equipamento novo nasce com QR — a etiqueta é impressa pelo próprio
   * Orbit, e pedir que alguém a digitasse antes de ela existir invertia a ordem
   * dos fatos.
   *
   * Na edição o campo volta: quem etiquetou o parque antes de usar o Orbit
   * precisa fazer o sistema bater com a etiqueta que já está colada.
   */
  const geraCodigo = !editing;

  const payload = (): CreateAssetInput => ({
    businessUnitId: form.businessUnitId,
    customerId: optional(form.customerId),
    category: form.category,
    name: form.name.trim(),
    manufacturer: optional(form.manufacturer),
    model: optional(form.model),
    serialNumber: optional(form.serialNumber),
    /*
      Sempre QR.

      O campo que perguntava o tipo saiu: ele oferecia seis respostas para uma
      pergunta que o produto já tinha resolvido — a etiqueta é impressa aqui. O
      valor viaja sozinho na criação, e o servidor o gera.
    */
    identifierType: AssetIdentifierType.QR_CODE,
    identifier: optional(form.identifier),
    installationAt: optional(form.installationAt),
    warrantyUntil: optional(form.warrantyUntil),
    location: optional(form.location),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const input = payload();

    const done = (asset: Asset) => {
      onSaved?.(asset);
      onOpenChange(false);
    };

    if (editing) {
      update.mutate(input as UpdateAssetInput, { onSuccess: done });
      return;
    }
    create.mutate(input, { onSuccess: done });
  };

  /** O botão só espelha o que o DTO exige; quem valida de fato é o servidor. */
  const incomplete =
    form.name.trim().length < ASSET_LIMITS.nameMinLength ||
    !form.businessUnitId;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {editing ? "Editar equipamento" : "Novo equipamento"}
        </DialogTitle>
        <DialogDescription>
          {customerId
            ? "O equipamento fica vinculado a este cliente."
            : "Cadastro do equipamento sob contrato."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" htmlFor="asset-name" className="sm:col-span-2" required>
          <Input
            id="asset-name"
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
            maxLength={ASSET_LIMITS.nameMaxLength}
            placeholder="Ex.: Split Hi-Wall — Sala de reuniões"
            required
          />
        </Field>

        <Field label="Categoria" htmlFor="asset-category">
          <Select
            value={form.category}
            onValueChange={(value) => set("category", value as AssetCategory)}
          >
            <SelectTrigger id="asset-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(AssetCategory).map((category) => (
                <SelectItem key={category} value={category}>
                  {ASSET_CATEGORY_LABELS[category] ?? category}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Unidade" htmlFor="asset-unit" required>
          <Select
            value={form.businessUnitId}
            onValueChange={(value) => set("businessUnitId", value)}
          >
            <SelectTrigger id="asset-unit" aria-required="true">
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

        {/*
          Aberto de dentro do cliente, o vínculo é fixo: trocá-lo aqui moveria o
          equipamento para outro cliente sem que a tela desse a entender isso.
        */}
        {customerId ? null : (
          <div className="sm:col-span-2">
            <ReferencePicker
              id="asset-customer"
              label="Cliente"
              placeholder="Sem cliente"
              value={form.customerId || undefined}
              selectedLabel={
                editing?.customer?.tradeName ??
                editing?.customer?.legalName ??
                undefined
              }
              queryKey={schedulingReferencesService.keys.customers}
              fetcher={(search, options) =>
                schedulingReferencesService.customers(search, options)
              }
              toOption={(customer) => ({
                id: customer.id,
                label: customer.tradeName ?? customer.legalName,
              })}
              onChange={(value) => set("customerId", value ?? "")}
            />
          </div>
        )}

        <Field label="Fabricante" htmlFor="asset-manufacturer">
          <Input
            id="asset-manufacturer"
            value={form.manufacturer}
            onChange={(event) => set("manufacturer", event.target.value)}
            maxLength={ASSET_LIMITS.manufacturerMaxLength}
          />
        </Field>

        <Field label="Modelo" htmlFor="asset-model">
          <Input
            id="asset-model"
            value={form.model}
            onChange={(event) => set("model", event.target.value)}
            maxLength={ASSET_LIMITS.modelMaxLength}
          />
        </Field>

        <Field label="Número de série" htmlFor="asset-serial">
          <Input
            id="asset-serial"
            value={form.serialNumber}
            onChange={(event) => set("serialNumber", event.target.value)}
            maxLength={ASSET_LIMITS.serialNumberMaxLength}
            className="font-mono"
          />
        </Field>

        <Field label="Localização" htmlFor="asset-location">
          <Input
            id="asset-location"
            value={form.location}
            onChange={(event) => set("location", event.target.value)}
            maxLength={ASSET_LIMITS.locationMaxLength}
            placeholder="Ex.: 3º andar, ala norte"
          />
        </Field>

        {/*
          Na criação o identificador não é pedido: o equipamento nasce com QR, e
          a etiqueta é impressa pelo Orbit. Na edição o campo volta — quem
          etiquetou o parque antes precisa fazer o sistema bater com o que já
          está colado.
        */}
        {geraCodigo ? (
          <Field label="Identificador (QR Code)">
            <p className="text-muted-foreground text-sm">
              Gerado ao cadastrar, na contagem da sua organização. A etiqueta
              para impressão fica disponível na ficha do equipamento.
            </p>
          </Field>
        ) : (
          <Field
            label="Identificador"
            htmlFor="asset-identifier"
            hint="Deixe em branco para o sistema gerar, ou informe o código que já está na etiqueta."
          >
            <Input
              id="asset-identifier"
              value={form.identifier}
              onChange={(event) => set("identifier", event.target.value)}
              maxLength={ASSET_LIMITS.identifierMaxLength}
              className="font-mono"
            />
          </Field>
        )}

        <Field label="Instalação" htmlFor="asset-installation">
          <Input
            id="asset-installation"
            type="date"
            value={form.installationAt}
            onChange={(event) => set("installationAt", event.target.value)}
          />
        </Field>

        <Field label="Garantia até" htmlFor="asset-warranty">
          <Input
            id="asset-warranty"
            type="date"
            value={form.warrantyUntil}
            onChange={(event) => set("warrantyUntil", event.target.value)}
          />
        </Field>
      </div>

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
          {mutation.isPending
            ? "Salvando…"
            : editing
              ? "Salvar"
              : "Criar equipamento"}
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
  required,
}: {
  label: string;
  /**
   * Opcional porque há um campo que não é campo: o identificador gerado é texto
   * informativo, sem controle para o rótulo apontar. Um `htmlFor` vazio apontaria
   * para `id` inexistente, e leitor de tela anuncia rótulo órfão.
   */
  htmlFor?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      {htmlFor ? (
        <Label htmlFor={htmlFor} required={required}>{label}</Label>
      ) : (
        <span className="text-sm font-medium leading-none">{label}</span>
      )}
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
