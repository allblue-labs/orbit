"use client";

/**
 * Criação administrativa de uma configuração de RVT.
 *
 * Só os campos que `CreateRvtConfigurationDto` aceita. Equipamentos, RT e
 * procedimento detalhado entram depois, na edição — escolher equipamento exige
 * o contexto de cliente e unidade que este formulário está definindo.
 *
 * ## Periodicidade são dois campos, não um
 *
 * O backend guarda `scheduleMode` (recorrente ou única) e o tipo de manutenção
 * separadamente. Este formulário oferece os dois porque são ortogonais: uma
 * visita avulsa também tem tipo, e o DTO exige ambos.
 *
 * O tipo não é mais um código fixo: vem da Central de Catálogos, onde a
 * organização cadastra os seus ritmos e o roteiro de checagens de cada um. É
 * dele que sai a cadência que gera as ocorrências, e é o checklist dele que os
 * técnicos preenchem em campo.
 *
 * A validação aqui é de usabilidade. As regras — código único, vigência
 * coerente, unidade no escopo do ator, quantidade de ocorrências geradas — são
 * do servidor, e a recusa dele aparece como veio.
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
import { Switch } from "@/components/ui/switch";
import { useCustomersList } from "@/hooks/customers/use-customers";
import {
  useCreateRvtConfiguration,
  useRvtMaintenanceTypes,
} from "@/hooks/rvt/use-rvt";
import { useActiveScope } from "@/providers/use-active-scope";
import { useSession } from "@/providers/session-provider";
import { SCHEDULE_MODE, cadenciaDe } from "@/registry";

export function RvtConfigurationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {/**
         * O formulário só existe enquanto o diálogo está aberto.
         *
         * Remontar a cada abertura é o que garante campos limpos. Sincronizar
         * por efeito deixaria um rascunho abandonado reaparecendo como se
         * fosse estado salvo — a pior forma de perder trabalho, porque
         * ninguém percebe.
         */}
        {open ? <CreateForm onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const { businessUnitId } = useActiveScope();
  const customers = useCustomersList({ limit: 100 });
  const create = useCreateRvtConfiguration();
  const tiposDeManutencao = useRvtMaintenanceTypes();

  const [customerId, setCustomerId] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"RECURRING" | "ONE_TIME">("RECURRING");
  const [type, setType] = useState("");
  const [coverageStart, setCoverageStart] = useState("");
  const [coverageEnd, setCoverageEnd] = useState("");
  const [city, setCity] = useState("");
  const [requiresRt, setRequiresRt] = useState(false);

  /** O fuso é o do usuário da sessão — a mesma autoridade que a Agenda usa. */
  const timezone = session.user?.timezone ?? "America/Recife";

  /**
   * Vigência final só é exigida quando há repetição.
   *
   * É regra do servidor (`Recurring RVT requires coverageEnd`), espelhada aqui
   * apenas para não deixar o usuário enviar um formulário que já se sabe
   * recusado. Quem decide continua sendo ele.
   */
  const ready =
    Boolean(customerId && code.trim() && name.trim() && coverageStart) &&
    Boolean(businessUnitId && type) &&
    (mode === "ONE_TIME" || Boolean(coverageEnd));

  const submit = () => {
    if (!ready || !businessUnitId) return;
    create.mutate(
      {
        businessUnitId,
        customerId,
        code: code.trim(),
        name: name.trim(),
        maintenanceTypeId: type,
        scheduleMode: mode,
        coverageStart,
        ...(mode === "RECURRING" && coverageEnd ? { coverageEnd } : {}),
        timezone,
        serviceLocation: city.trim() ? { city: city.trim() } : {},
        procedure: { items: [] },
        requiresTechnicalResponsible: requiresRt,
      },
      { onSuccess: onDone },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Nova visita técnica</DialogTitle>
        <DialogDescription>
          A configuração define a regra. As visitas previstas são geradas a partir dela e projetadas na Agenda.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="rvt-customer">Cliente</Label>
          <Select value={customerId} onValueChange={setCustomerId}>
            <SelectTrigger id="rvt-customer">
              <SelectValue placeholder="Selecione o cliente" />
            </SelectTrigger>
            <SelectContent>
              {(customers.data?.data ?? []).map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.tradeName ?? customer.legalName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rvt-code">Código</Label>
            <Input
              id="rvt-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="RVT-2026-001"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rvt-name">Nome</Label>
            <Input
              id="rvt-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Visita técnica — matriz"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rvt-mode">Agenda</Label>
            <Select
              value={mode}
              onValueChange={(value) =>
                setMode(value as "RECURRING" | "ONE_TIME")
              }
            >
              <SelectTrigger id="rvt-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SCHEDULE_MODE).map(([value, entry]) => (
                  <SelectItem key={value} value={value}>
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {SCHEDULE_MODE[mode]?.description}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rvt-type">Tipo de manutenção</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="rvt-type">
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {/*
                  Os ritmos cadastrados pela organização, com a cadência à
                  vista: é ela que define quantas visitas o contrato gera.
                */}
                {(tiposDeManutencao.data ?? []).map((tipo) => (
                  <SelectItem key={tipo.id} value={tipo.id}>
                    {`${tipo.label} · ${cadenciaDe(tipo)}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tiposDeManutencao.data?.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum tipo cadastrado. Cadastre em Central de Catálogos → RVT.
              </p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rvt-start">Início da vigência</Label>
            <Input
              id="rvt-start"
              type="date"
              value={coverageStart}
              onChange={(event) => setCoverageStart(event.target.value)}
            />
          </div>
          {mode === "RECURRING" ? (
            <div className="space-y-2">
              <Label htmlFor="rvt-end">Fim da vigência</Label>
              <Input
                id="rvt-end"
                type="date"
                value={coverageEnd}
                onChange={(event) => setCoverageEnd(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="rvt-city">Local do serviço</Label>
          <Input
            id="rvt-city"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="Cidade"
          />
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
          <div className="min-w-0">
            <Label htmlFor="rvt-rt" className="text-sm">
              Exige Responsável Técnico
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Quando exigido, o RVT só é concluído com a assinatura do RT.
            </p>
          </div>
          <Switch
            id="rvt-rt"
            checked={requiresRt}
            onCheckedChange={setRequiresRt}
          />
        </div>

        <MutationError error={create.error} />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onDone} disabled={create.isPending}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={!ready || create.isPending}>
          {create.isPending ? "Criando…" : "Criar visita técnica"}
        </Button>
      </DialogFooter>
    </>
  );
}
