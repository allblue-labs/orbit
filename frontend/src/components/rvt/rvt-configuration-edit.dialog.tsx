"use client";

/**
 * Edição de uma configuração de RVT.
 *
 * ## O que não se edita, e por quê
 *
 * `UpdateRvtConfigurationDto` marca unidade, cliente, código e modo de agenda
 * como `never`. Não é omissão: trocar qualquer um transformaria a configuração
 * em outra, com as visitas da anterior penduradas nela. Aparecem como
 * contexto, em texto.
 *
 * ## A agenda futura é reconciliada pelo servidor
 *
 * Mudar periodicidade ou vigência muda quais visitas devem existir. Quem
 * decide é o backend: ele remarca ou cancela apenas as **futuras e
 * intocadas**, preserva as já realizadas, e devolve quantas foram criadas,
 * canceladas e remarcadas. A tela mostra esse resultado — não o deduz
 * comparando listas, nem apaga ou recria ocorrência nenhuma.
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
import {
  useRvtMaintenanceTypes,
  useUpdateRvtConfiguration,
} from "@/hooks/rvt/use-rvt";
import { SCHEDULE_MODE, cadenciaDe } from "@/registry";
import type { RvtConfiguration, RvtReconciliation } from "@/types/rvt";

export function RvtConfigurationEditDialog({
  configuration,
  open,
  onOpenChange,
}: {
  configuration: RvtConfiguration;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        {/** Remontado a cada abertura: o formulário parte sempre do salvo. */}
        {open ? (
          <EditForm
            configuration={configuration}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({
  configuration,
  onClose,
}: {
  configuration: RvtConfiguration;
  onClose: () => void;
}) {
  const update = useUpdateRvtConfiguration(configuration.id);
  const tiposDeManutencao = useRvtMaintenanceTypes();
  const [result, setResult] = useState<RvtReconciliation | null>(null);

  const [name, setName] = useState(configuration.name);
  const [type, setType] = useState(configuration.maintenanceType?.id ?? "");
  const [coverageStart, setCoverageStart] = useState(
    configuration.coverage.start,
  );
  const [coverageEnd, setCoverageEnd] = useState(
    configuration.coverage.end ?? "",
  );
  const [requiresRt, setRequiresRt] = useState(
    configuration.requiresTechnicalResponsible,
  );

  const recurring = configuration.scheduleMode === "RECURRING";
  const ready =
    Boolean(name.trim() && type) && (!recurring || Boolean(coverageEnd));

  const submit = () => {
    if (!ready) return;
    update.mutate(
      {
        name: name.trim(),
        maintenanceTypeId: type,
        coverageStart,
        ...(recurring && coverageEnd ? { coverageEnd } : {}),
        requiresTechnicalResponsible: requiresRt,
      },
      { onSuccess: (data) => setResult(data.reconciliation) },
    );
  };

  if (result) return <Reconciled result={result} onClose={onClose} />;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar visita técnica</DialogTitle>
        <DialogDescription>
          As visitas futuras ainda não realizadas são reajustadas. As já realizadas permanecem como estão.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <dl className="grid gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Código</dt>
            <dd className="font-mono text-xs">{configuration.code}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Cliente</dt>
            <dd className="truncate">{configuration.customer.name}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Agenda</dt>
            <dd>{SCHEDULE_MODE[configuration.scheduleMode]?.label ?? "—"}</dd>
          </div>
        </dl>

        <div className="space-y-2">
          <Label htmlFor="rvt-edit-name">Nome</Label>
          <Input
            id="rvt-edit-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="rvt-edit-type">Tipo de manutenção</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="rvt-edit-type">
              <SelectValue placeholder="Selecione" />
            </SelectTrigger>
            <SelectContent>
              {/*
                Os ritmos cadastrados pela organização.

                Eram dois códigos fixos traduzidos no cliente. A cadência de
                cada um vem junto para quem escolhe conferir o que está
                contratando.
              */}
              {(tiposDeManutencao.data ?? []).map((tipo) => (
                <SelectItem key={tipo.id} value={tipo.id}>
                  {`${tipo.label} · ${cadenciaDe(tipo)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="rvt-edit-start">Início da vigência</Label>
            <Input
              id="rvt-edit-start"
              type="date"
              value={coverageStart}
              onChange={(event) => setCoverageStart(event.target.value)}
            />
          </div>
          {recurring ? (
            <div className="space-y-2">
              <Label htmlFor="rvt-edit-end">Fim da vigência</Label>
              <Input
                id="rvt-edit-end"
                type="date"
                value={coverageEnd}
                onChange={(event) => setCoverageEnd(event.target.value)}
              />
            </div>
          ) : null}
        </div>

        <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
          <div className="min-w-0">
            <Label htmlFor="rvt-edit-rt" className="text-sm">
              Exige Responsável Técnico
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Quando exigido, o RVT só é concluído com a assinatura do RT.
            </p>
          </div>
          <Switch
            id="rvt-edit-rt"
            checked={requiresRt}
            onCheckedChange={setRequiresRt}
          />
        </div>

        <MutationError error={update.error} />
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={update.isPending}>
          Cancelar
        </Button>
        <Button onClick={submit} disabled={!ready || update.isPending}>
          {update.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * O que o servidor fez com a agenda.
 *
 * Três números que vêm da resposta. Mostrá-los evita a pergunta que sempre
 * vem depois de editar uma recorrência — "e as visitas que já estavam
 * marcadas?" — e deixa claro que quem mexeu na agenda foi o servidor.
 */
function Reconciled({
  result,
  onClose,
}: {
  result: RvtReconciliation;
  onClose: () => void;
}) {
  const nothing =
    result.created === 0 && result.cancelled === 0 && result.rescheduled === 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Visita técnica atualizada</DialogTitle>
        <DialogDescription>
          {nothing
            ? "A agenda de visitas futuras não precisou de ajuste."
            : "As visitas futuras ainda não realizadas foram reajustadas."}
        </DialogDescription>
      </DialogHeader>

      {nothing ? null : (
        <ul className="space-y-1 text-sm" aria-label="Ajustes na agenda">
          {result.created > 0 ? (
            <li>
              <strong className="tabular-nums">{result.created}</strong>{" "}
              visita(s) criada(s)
            </li>
          ) : null}
          {result.rescheduled > 0 ? (
            <li>
              <strong className="tabular-nums">{result.rescheduled}</strong>{" "}
              visita(s) remarcada(s)
            </li>
          ) : null}
          {result.cancelled > 0 ? (
            <li>
              <strong className="tabular-nums">{result.cancelled}</strong>{" "}
              visita(s) cancelada(s)
            </li>
          ) : null}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        As visitas já realizadas não foram alteradas.
      </p>

      <DialogFooter>
        <Button onClick={onClose}>Fechar</Button>
      </DialogFooter>
    </>
  );
}
