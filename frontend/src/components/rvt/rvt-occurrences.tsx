"use client";

import { useState } from "react";
import { CalendarClock, Pencil, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import { useManageRvtVisit } from "@/hooks/rvt/use-rvt";
import { useFieldTechnicians } from "@/hooks/workforce/use-workforce";
import { useSession } from "@/providers/session-provider";
import { ROUTES } from "@/lib/routes";
import type { RvtConfiguration, RvtOccurrence } from "@/types/rvt";
import { DueStateBadge, OccurrenceStatusBadge } from "./rvt-presentation";
import { RvtSelect } from "./rvt-configuration.dialog";

export function RvtOccurrencesPanel({
  configuration,
}: {
  configuration: RvtConfiguration;
}) {
  const { formatDateTime } = useDateFormatters();
  const session = useSession();
  const canManage = session.hasPermission("rvt.manage");
  const [editing, setEditing] = useState<RvtOccurrence | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<{
    visit: RvtOccurrence;
    remove: boolean;
  } | null>(null);
  const mutation = useManageRvtVisit(configuration.id);
  const technicians = useFieldTechnicians(
    { businessUnitId: configuration.businessUnit.id },
    canManage,
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Gerencie a agenda, os equipamentos e o técnico de cada visita.
        </p>
        {canManage && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-4" />
            Adicionar visita
          </Button>
        )}
      </div>
      {!configuration.occurrences.length ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <CalendarClock className="mx-auto mb-2 size-5" />
          Nenhuma visita prevista.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Visita</TableHead>
                <TableHead>Data prevista</TableHead>
                <TableHead>Técnico previsto</TableHead>
                <TableHead>Equipamentos</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {configuration.occurrences.map((visit) => (
                <TableRow key={visit.id}>
                  <TableCell className="font-mono">{visit.sequence}</TableCell>
                  <TableCell>
                    <div className="space-y-1">
                      <p className="text-sm">
                        {formatDateTime(visit.scheduledFor)}
                      </p>
                      {visit.status === "SCHEDULED" && (
                        <DueStateBadge state={visit.dueState} />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {technicians.data?.find(
                      (item) => item.id === visit.responsibleFieldTechnicianId,
                    )?.name ??
                      (visit.responsibleFieldTechnicianId ===
                      configuration.defaultResponsibleFieldTechnician?.id
                        ? configuration.defaultResponsibleFieldTechnician.name
                        : visit.responsibleFieldTechnicianId
                          ? "Técnico atribuído"
                          : "Não atribuído")}
                  </TableCell>
                  <TableCell>
                    <p className="max-w-60 text-xs">
                      {visit.equipmentIds
                        .map(
                          (id) =>
                            configuration.equipment.find(
                              (item) => item.id === id,
                            )?.name ?? "Equipamento da visita",
                        )
                        .join(", ") || "Não definidos"}
                    </p>
                  </TableCell>
                  <TableCell>
                    <OccurrenceStatusBadge status={visit.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {visit.executionId && (
                        <Button asChild variant="ghost" size="sm">
                          <Link
                            href={`${ROUTES.rvt}/execucoes/${visit.executionId}`}
                          >
                            Abrir visita
                          </Link>
                        </Button>
                      )}
                      {canManage && !visit.executionId && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditing(visit)}
                            aria-label={`Editar visita ${visit.sequence}`}
                          >
                            <Pencil className="size-4" />
                          </Button>
                          {visit.status !== "CANCELLED" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                setConfirmation({ visit, remove: false })
                              }
                              aria-label={`Cancelar visita ${visit.sequence}`}
                            >
                              <X className="size-4" />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setConfirmation({ visit, remove: true })
                            }
                            aria-label={`Excluir visita ${visit.sequence}`}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          {editing && (
            <VisitForm
              key={typeof editing === "string" ? "new" : editing.id}
              configuration={configuration}
              visit={editing === "new" ? undefined : editing}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmation?.remove ? "Excluir visita?" : "Cancelar visita?"}
            </DialogTitle>
            <DialogDescription>
              {confirmation?.remove
                ? "A visita será retirada da lista e da agenda. O registro de auditoria será preservado."
                : "O agendamento será cancelado. Você poderá reabrir e remarcar esta visita depois."}{" "}
              Visitas iniciadas ou concluídas permanecem protegidas.
            </DialogDescription>
          </DialogHeader>
          <MutationError error={mutation.error} />
          <DialogFooter>
            <Button
              variant="ghost"
              disabled={mutation.isPending}
              onClick={() => setConfirmation(null)}
            >
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={mutation.isPending}
              onClick={() => {
                if (confirmation)
                  mutation.mutate(
                    {
                      id: confirmation.visit.id,
                      remove: confirmation.remove,
                      input: { status: "CANCELLED" },
                    },
                    { onSuccess: () => setConfirmation(null) },
                  );
              }}
            >
              {mutation.isPending ? "Salvando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VisitForm({
  configuration,
  visit,
  onDone,
}: {
  configuration: RvtConfiguration;
  visit?: RvtOccurrence;
  onDone: () => void;
}) {
  const [date, setDate] = useState(visit?.localScheduledDate ?? "");
  const [time, setTime] = useState(
    visit?.scheduledFor
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: configuration.timezone,
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).format(new Date(visit.scheduledFor))
      : configuration.startTime,
  );
  const [technician, setTechnician] = useState(
    visit
      ? (visit.responsibleFieldTechnicianId ?? "")
      : (configuration.defaultResponsibleFieldTechnician?.id ?? ""),
  );
  const [equipmentIds, setEquipmentIds] = useState<string[]>([
    ...(
      visit?.equipmentIds ?? configuration.equipment.map((item) => item.id)
    ).filter((id) => configuration.equipment.some((item) => item.id === id)),
  ]);
  const [status, setStatus] = useState(
    visit?.status === "CANCELLED" ? "CANCELLED" : "SCHEDULED",
  );
  const technicians = useFieldTechnicians({
    businessUnitId: configuration.businessUnit.id,
  });
  const mutation = useManageRvtVisit(configuration.id);
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {visit ? `Editar visita ${visit.sequence}` : "Adicionar visita"}
        </DialogTitle>
        <DialogDescription>
          Defina o horário, os equipamentos e quem fará o atendimento. Campos
          com * são obrigatórios.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="rvt-visit-date">Data *</Label>
            <Input
              id="rvt-visit-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rvt-visit-time">Horário *</Label>
            <Input
              id="rvt-visit-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Fuso horário: {configuration.timezone}
        </p>
        <RvtSelect
          label="Técnico de campo"
          value={technician}
          onChange={setTechnician}
          optional
          options={(technicians.data ?? []).map((item) => ({
            id: item.id,
            label: item.name,
          }))}
        />
        <RvtSelect
          label="Situação"
          value={status}
          onChange={setStatus}
          options={[
            { id: "SCHEDULED", label: "Agendada" },
            { id: "CANCELLED", label: "Cancelada" },
          ]}
        />
        <Label>Equipamentos desta visita *</Label>
        <div className="max-h-64 space-y-2 overflow-y-auto">
          {configuration.equipment.map((item) => (
            <label
              key={item.id}
              className="flex items-center gap-3 rounded-xl border p-3 text-sm"
            >
              <Checkbox
                checked={equipmentIds.includes(item.id)}
                onCheckedChange={(checked) =>
                  setEquipmentIds((current) =>
                    checked
                      ? [...current.filter((id) => id !== item.id), item.id]
                      : current.filter((id) => id !== item.id),
                  )
                }
              />
              {item.name}
            </label>
          ))}
        </div>
        {!configuration.equipment.length && (
          <p className="text-sm text-muted-foreground">
            Inclua equipamentos na configuração do RVT antes de criar uma
            visita.
          </p>
        )}
        <MutationError error={mutation.error ?? technicians.error} />
      </div>
      <DialogFooter>
        <Button variant="ghost" disabled={mutation.isPending} onClick={onDone}>
          Voltar
        </Button>
        <Button
          disabled={
            !date || !time || !equipmentIds.length || mutation.isPending
          }
          onClick={() =>
            mutation.mutate(
              {
                id: visit?.id,
                input: {
                  scheduledDate: date,
                  startTime: time,
                  responsibleFieldTechnicianId: technician || null,
                  equipmentIds,
                  status: status as "SCHEDULED" | "CANCELLED",
                },
              },
              { onSuccess: onDone },
            )
          }
        >
          {mutation.isPending ? "Salvando…" : "Salvar visita"}
        </Button>
      </DialogFooter>
    </>
  );
}
