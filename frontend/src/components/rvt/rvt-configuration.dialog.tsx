"use client";

import { useState } from "react";
import {
  Check,
  ClipboardList,
  MapPin,
  CalendarClock,
  Users,
} from "lucide-react";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PostalCodeField } from "@/components/address/postal-code-field";
import { CustomerPicker } from "@/components/customers/customer-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useCustomerAddresses } from "@/hooks/customers/use-customers";
import { useAssetsList } from "@/hooks/assets/use-assets";
import {
  useCreateRvtConfiguration,
  useUpdateRvtConfiguration,
  useRvtMaintenanceTypes,
} from "@/hooks/rvt/use-rvt";
import {
  useFieldTechnicians,
  useTechnicalResponsibles,
} from "@/hooks/workforce/use-workforce";
import { useSchedulingCalendars } from "@/hooks/scheduling/use-scheduling";
import { useActiveScope } from "@/providers/use-active-scope";
import { useTimeZone } from "@/hooks/use-timezone";
import { cadenciaDe } from "@/registry";
import type {
  RvtConfiguration,
  RvtEquipment,
  UpdateRvtConfigurationInput,
} from "@/types/rvt";

const steps = ["Cliente", "Equipamentos e local", "Programação", "Revisão"];
const icons = [Users, MapPin, CalendarClock, ClipboardList];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function RvtConfigurationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
        {open && <RvtConfigurationForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

export function RvtConfigurationForm({
  configuration,
  onDone,
}: {
  configuration?: RvtConfiguration;
  onDone: () => void;
}) {
  const scope = useActiveScope();
  const { timeZone } = useTimeZone();
  const [businessUnitId, setBusinessUnitId] = useState(
    configuration?.businessUnit.id ??
      scope.businessUnitId ??
      (scope.businessUnits.length === 1 ? scope.businessUnits[0].id : ""),
  );
  const timezone = configuration?.timezone ?? timeZone;
  const [step, setStep] = useState(0);
  const [customerId, setCustomerId] = useState(
    configuration?.customer.id ?? "",
  );
  const [customerName, setCustomerName] = useState(
    configuration?.customer.name ?? "",
  );
  const [code, setCode] = useState(
    () => configuration?.code ?? `RVT-${Date.now().toString(36).toUpperCase()}`,
  );
  const [name, setName] = useState(configuration?.name ?? "");
  const [mode, setMode] = useState<"ONE_TIME" | "RECURRING">(
    configuration?.scheduleMode === "RECURRING" ? "RECURRING" : "ONE_TIME",
  );
  const [type, setType] = useState(configuration?.maintenanceType?.id ?? "");
  const [start, setStart] = useState(configuration?.coverage.start ?? "");
  const [end, setEnd] = useState(configuration?.coverage.end ?? "");
  const [startTime, setStartTime] = useState(
    configuration?.startTime ?? "09:00",
  );
  const [calendarId, setCalendarId] = useState(configuration?.calendarId ?? "");
  const [technicianId, setTechnicianId] = useState(
    configuration?.defaultResponsibleFieldTechnician?.id ?? "",
  );
  const [requiresRt, setRequiresRt] = useState(
    configuration?.requiresTechnicalResponsible ?? false,
  );
  const [rtId, setRtId] = useState(
    configuration?.technicalResponsible?.id ?? "",
  );
  const [location, setLocation] = useState<Record<string, unknown>>(
    record(configuration?.serviceLocation),
  );
  const [procedure, setProcedure] = useState(
    String(record(configuration?.procedure).description ?? ""),
  );
  const [equipment, setEquipment] = useState<RvtEquipment[]>([
    ...(configuration?.equipment ?? []),
  ]);
  const [equipmentSearch, setEquipmentSearch] = useState("");
  const [equipmentPage, setEquipmentPage] = useState(1);
  const assets = useAssetsList(
    {
      customerId,
      businessUnitId: businessUnitId || undefined,
      search: equipmentSearch || undefined,
      page: equipmentPage,
      limit: 30,
    },
    { enabled: Boolean(customerId && businessUnitId) },
  );
  const addresses = useCustomerAddresses(customerId || null, true);
  const [addressId, setAddressId] = useState("");
  const types = useRvtMaintenanceTypes();
  const technicians = useFieldTechnicians(
    {
      businessUnitId: businessUnitId || undefined,
    },
    Boolean(businessUnitId),
  );
  const rts = useTechnicalResponsibles(
    { businessUnitId: businessUnitId || undefined },
    requiresRt,
  );
  const calendars = useSchedulingCalendars(businessUnitId ?? undefined);
  const create = useCreateRvtConfiguration();
  const update = useUpdateRvtConfiguration(configuration?.id ?? "");
  const mutation = configuration ? update : create;
  const text = (key: string) =>
    typeof location[key] === "string" ? (location[key] as string) : "";
  const setAddress = (key: string, value: string) =>
    setLocation((current) => ({ ...current, [key]: value }));
  const ready = [
    Boolean(
      customerId &&
      code.trim().length >= 3 &&
      name.trim().length >= 3 &&
      businessUnitId,
    ),
    Boolean(
      equipment.length &&
      text("street").trim() &&
      text("city").trim() &&
      text("state").trim(),
    ),
    Boolean(
      type &&
      start &&
      startTime &&
      (mode === "ONE_TIME" || (end && end >= start)) &&
      (!requiresRt || rtId),
    ),
    true,
  ];
  const submit = () => {
    if (!ready.every(Boolean) || !businessUnitId) return;
    const common: UpdateRvtConfigurationInput = {
      name: name.trim(),
      maintenanceTypeId: type,
      coverageStart: start,
      ...(mode === "RECURRING" ? { coverageEnd: end } : {}),
      startTime,
      calendarId: calendarId || null,
      timezone,
      serviceLocation: location,
      equipmentIds: equipment.map((item) => item.id),
      defaultResponsibleFieldTechnicianId: technicianId || null,
      technicalResponsibleUserId: rtId || null,
      requiresTechnicalResponsible: requiresRt,
      procedure: {
        ...record(configuration?.procedure),
        description: procedure.trim(),
      },
    };
    if (configuration) update.mutate(common, { onSuccess: onDone });
    else
      create.mutate(
        {
          ...common,
          name: name.trim(),
          maintenanceTypeId: type,
          coverageStart: start,
          timezone,
          serviceLocation: location,
          procedure: { description: procedure.trim() },
          businessUnitId,
          customerId,
          code: code.trim(),
          scheduleMode: mode,
        },
        { onSuccess: onDone },
      );
  };
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {configuration ? "Configurar RVT" : "Novo RVT"}
        </DialogTitle>
        <DialogDescription>
          Visitas técnicas avulsas ou recorrentes, com os equipamentos e a
          equipe definidos em poucos passos. Campos com * são obrigatórios.
        </DialogDescription>
      </DialogHeader>
      <ol className="grid grid-cols-4 gap-2" aria-label="Etapas do RVT">
        {steps.map((label, i) => {
          const Icon = icons[i];
          return (
            <li
              key={label}
              aria-current={step === i ? "step" : undefined}
              className={`rounded-xl border p-2 text-center text-xs sm:p-3 ${i === step ? "border-primary bg-primary/5 text-primary" : "text-muted-foreground"}`}
            >
              <span className="mb-1 flex justify-center">
                {i < step ? (
                  <Check className="size-4" />
                ) : (
                  <Icon className="size-4" />
                )}
              </span>
              {label}
            </li>
          );
        })}
      </ol>
      <div className="min-h-72 space-y-5 py-2">
        {step === 0 && (
          <>
            {(scope.businessUnits.length > 1 || !businessUnitId) && (
              <RvtSelect
                label="Unidade *"
                value={businessUnitId}
                disabled={Boolean(configuration)}
                onChange={(id) => {
                  setBusinessUnitId(id);
                  setEquipment([]);
                  setEquipmentPage(1);
                  setCalendarId("");
                  setTechnicianId("");
                  setRtId("");
                }}
                options={scope.businessUnits.map((unit) => ({
                  id: unit.id,
                  label: unit.tradeName ?? unit.legalName,
                }))}
              />
            )}
            <div className="space-y-2">
              <Label htmlFor="rvt-customer">Cliente *</Label>
              <CustomerPicker
                id="rvt-customer"
                value={customerId || undefined}
                selectedLabel={customerName || undefined}
                required
                disabled={Boolean(configuration)}
                onChange={(customer) => {
                  if (customer?.id === customerId) return;
                  setCustomerId(customer?.id ?? "");
                  setAddressId("");
                  setEquipment([]);
                  setEquipmentPage(1);
                  setCustomerName(
                    customer?.tradeName || customer?.legalName || "",
                  );
                  setLocation({
                    ...record(customer?.address),
                    state:
                      record(customer?.address).stateCode ??
                      record(customer?.address).state ??
                      "",
                  });
                }}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Código *"
                value={code}
                disabled={Boolean(configuration)}
                onChange={setCode}
              />
              <Field
                label="Nome do atendimento *"
                value={name}
                onChange={setName}
                placeholder="Visita técnica — loja central"
              />
            </div>
            <Field
              label="Orientações para o atendimento (opcional)"
              value={procedure}
              onChange={setProcedure}
              multiline
            />
          </>
        )}
        {step === 1 && (
          <>
            <div className="space-y-3">
              <Label>Equipamentos * · {equipment.length} selecionado(s)</Label>
              <Input
                aria-label="Buscar equipamento"
                value={equipmentSearch}
                onChange={(event) => {
                  setEquipmentSearch(event.target.value);
                  setEquipmentPage(1);
                }}
                placeholder="Buscar equipamento"
              />
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-xl border p-3">
                {assets.isFetching && (
                  <p className="text-sm text-muted-foreground">
                    Carregando equipamentos…
                  </p>
                )}
                {!assets.isPlaceholderData &&
                  (assets.data?.data ?? []).map((asset) => (
                    <label
                      key={asset.id}
                      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 hover:bg-muted/40"
                    >
                      <Checkbox
                        checked={equipment.some((item) => item.id === asset.id)}
                        onCheckedChange={(checked) =>
                          setEquipment((current) =>
                            checked
                              ? [
                                  ...current.filter(
                                    (item) => item.id !== asset.id,
                                  ),
                                  asset,
                                ]
                              : current.filter((item) => item.id !== asset.id),
                          )
                        }
                      />
                      <span className="min-w-0 text-sm">
                        <span className="block font-medium">{asset.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {asset.identifier ??
                            asset.serialNumber ??
                            asset.category}
                        </span>
                      </span>
                    </label>
                  ))}
                {!assets.isFetching && !assets.data?.data.length && (
                  <p className="text-sm text-muted-foreground">
                    Nenhum equipamento encontrado para este cliente nesta
                    unidade. Cadastre os equipamentos na ficha do cliente.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={equipmentPage === 1}
                  onClick={() => setEquipmentPage((value) => value - 1)}
                >
                  Anterior
                </Button>
                <span className="text-xs text-muted-foreground">
                  Página {equipmentPage}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    assets.isFetching ||
                    equipmentPage >= (assets.data?.meta.totalPages ?? 1)
                  }
                  onClick={() => setEquipmentPage((value) => value + 1)}
                >
                  Próxima
                </Button>
              </div>
              {equipment.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Selecionados: {equipment.map((item) => item.name).join(", ")}
                </p>
              )}
              <MutationError error={assets.error} />
            </div>
            <RvtSelect
              label="Usar endereço de atendimento do cliente"
              value={addressId}
              optional
              onChange={(id) => {
                setAddressId(id);
                const address = addresses.data?.find((item) => item.id === id);
                if (address)
                  setLocation({
                    ...address,
                    street: address.street,
                    city: address.city,
                    state: address.stateCode,
                  });
              }}
              options={(addresses.data ?? []).map((item) => ({
                id: item.id,
                label: `${item.label} · ${item.summary}`,
              }))}
            />
            <PostalCodeField
              id="rvt-postal-code"
              value={text("postalCode")}
              onChange={(value) => setAddress("postalCode", value)}
              onAddressFound={(address) =>
                setLocation((current) => ({
                  ...current,
                  ...address,
                  state: address.stateCode,
                }))
              }
            />
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                ["street", "Rua / logradouro *"],
                ["number", "Número"],
                ["complement", "Complemento"],
                ["district", "Bairro"],
                ["city", "Cidade *"],
                ["state", "UF *"],
                ["reference", "Ponto de referência"],
              ].map(([key, label]) => (
                <Field
                  key={key}
                  label={label}
                  value={text(key)}
                  onChange={(value) => setAddress(key, value)}
                />
              ))}
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <RvtSelect
                label="Agenda *"
                value={mode}
                disabled={Boolean(configuration)}
                onChange={(value) => setMode(value as typeof mode)}
                options={[
                  { id: "ONE_TIME", label: "Visita única" },
                  { id: "RECURRING", label: "Visitas recorrentes" },
                ]}
              />
              <RvtSelect
                label="Tipo de atendimento *"
                value={type}
                onChange={setType}
                options={(types.data ?? []).map((item) => ({
                  id: item.id,
                  label: `${item.label} · ${cadenciaDe(item)}`,
                }))}
              />
            </div>
            {types.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Cadastre os tipos e seus checklists na Central de Catálogos →
                RVT.
              </p>
            )}
            <MutationError error={types.error} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field
                label={
                  mode === "ONE_TIME" ? "Data da visita *" : "Primeira visita *"
                }
                type="date"
                value={start}
                onChange={setStart}
              />
              <Field
                label="Horário *"
                type="time"
                value={startTime}
                onChange={setStartTime}
              />
              {mode === "RECURRING" && (
                <Field
                  label="Fim da vigência *"
                  type="date"
                  value={end}
                  onChange={setEnd}
                />
              )}
            </div>
            {end && mode === "RECURRING" && end < start && (
              <p role="alert" className="text-sm text-destructive">
                O fim da vigência deve ser igual ou posterior ao início.
              </p>
            )}
            <RvtSelect
              label="Calendário"
              value={calendarId}
              onChange={setCalendarId}
              optional
              options={(calendars.data ?? []).map((item) => ({
                id: item.id,
                label: item.name,
              }))}
            />
            <RvtSelect
              label="Técnico de campo previsto"
              value={technicianId}
              onChange={setTechnicianId}
              optional
              options={(technicians.data ?? []).map((item) => ({
                id: item.id,
                label: item.name,
              }))}
            />
            <p className="text-xs text-muted-foreground">
              Fuso horário: {timezone}. O técnico pode ser definido ou
              substituído em cada visita.
            </p>
            <label className="flex items-center gap-3 rounded-xl border p-3 text-sm">
              <Checkbox
                checked={requiresRt}
                onCheckedChange={(value) => setRequiresRt(value === true)}
              />
              Exigir assinatura de Responsável Técnico
            </label>
            {requiresRt && (
              <RvtSelect
                label="Responsável Técnico *"
                value={rtId}
                onChange={setRtId}
                options={(rts.data ?? []).map((item) => ({
                  id: item.id,
                  label: item.name,
                }))}
              />
            )}
            <MutationError
              error={technicians.error ?? calendars.error ?? rts.error}
            />
          </>
        )}
        {step === 3 && (
          <div className="space-y-4 rounded-xl border bg-muted/20 p-5">
            <h3 className="font-semibold">Confira o atendimento</h3>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {[
                ["Cliente", customerName],
                ["RVT", `${code} · ${name}`],
                [
                  "Atendimento",
                  mode === "ONE_TIME"
                    ? "Visita única"
                    : types.data?.find((item) => item.id === type)?.label,
                ],
                [
                  "Programação",
                  `${start} às ${startTime}${mode === "RECURRING" ? ` até ${end}` : ""}`,
                ],
                [
                  "Local",
                  [
                    text("street"),
                    text("number"),
                    text("complement"),
                    text("city"),
                    text("state"),
                  ]
                    .filter(Boolean)
                    .join(", "),
                ],
                [
                  "Técnico previsto",
                  technicians.data?.find((item) => item.id === technicianId)
                    ?.name ?? "Definir por visita",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-words">{value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <p className="text-xs text-muted-foreground">
                Equipamentos de cada visita
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {equipment.map((item) => (
                  <li key={item.id}>• {item.name}</li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-muted-foreground">
              {configuration
                ? "Visitas já executadas e visitas ajustadas individualmente serão preservadas."
                : "As visitas serão criadas na agenda com os equipamentos selecionados. Você poderá ajustar cada visita depois."}
            </p>
          </div>
        )}
        <MutationError error={mutation.error} />
      </div>
      <DialogFooter className="gap-2">
        <Button
          variant="ghost"
          disabled={mutation.isPending}
          onClick={step > 0 ? () => setStep(step - 1) : onDone}
        >
          {step > 0 ? "Voltar" : "Cancelar"}
        </Button>
        <Button
          disabled={
            mutation.isPending ||
            !ready[step] ||
            (step === 3 && !ready.every(Boolean))
          }
          onClick={step === 3 ? submit : () => setStep(step + 1)}
        >
          {mutation.isPending
            ? "Salvando…"
            : step === 3
              ? configuration
                ? "Salvar configuração"
                : "Criar RVT e visitas"
              : "Continuar"}
        </Button>
      </DialogFooter>
    </>
  );
}

export function RvtSelect({
  label,
  value,
  onChange,
  options,
  optional,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { id: string; label: string }[];
  optional?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value || "__none__"}
        onValueChange={(id) => onChange(id === "__none__" ? "" : id)}
        disabled={disabled}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder="Selecione" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__" disabled={!optional}>
            {optional ? "Definir depois / automático" : "Selecione"}
          </SelectItem>
          {options.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  multiline?: boolean;
}) {
  const props = {
    value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    "aria-label": label,
    placeholder,
    disabled,
  };
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {multiline ? <Textarea {...props} /> : <Input type={type} {...props} />}
    </div>
  );
}
