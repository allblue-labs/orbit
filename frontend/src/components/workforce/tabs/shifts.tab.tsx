"use client";

/**
 * Escalas — janelas de disponibilidade por pessoa.
 *
 * ## Nada foi criado para isto
 *
 * `SchedulingAvailability` já existia, com tudo o que uma escala precisa:
 * `kind` (`AVAILABLE` · `BLOCKED`), dia da semana **ou** data específica,
 * minuto inicial e final, fuso e vigência. Os endpoints
 * `GET/POST/DELETE /scheduling/availability` também já existiam.
 *
 * Criar um modelo de escala no Workforce teria duplicado o que o motor de
 * agenda já consulta ao detectar conflito — e as duas fontes divergiriam na
 * primeira folga cadastrada só numa delas.
 *
 * ## O que a tela não faz
 *
 * Não decide se alguém está disponível **agora**: isso é o motor de agenda que
 * resolve, cruzando janelas, eventos e recorrências. Aqui se cadastra e se lê
 * a janela declarada.
 */
import { useState } from "react";
import { CalendarClock, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import { ManagementBlocked } from "../management-blocked";
import {
  useCreateSchedulingAvailability,
  useRemoveSchedulingAvailability,
  useSchedulingAvailability,
} from "@/hooks/scheduling/use-scheduling";
import { useTeamMembers } from "@/hooks/workforce/use-workforce";
import { cn } from "@/lib/utils";
import { ListState } from "@/workspace";

const WEEKDAYS = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado",
];

/** `startMinute`/`endMinute` são minutos desde a meia-noite, no fuso da janela. */
function toTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function ShiftsTab() {
  const members = useTeamMembers({ page: 1, limit: 100 });
  const shifts = useWorkforceManagement().shifts;

  const [userId, setUserId] = useState("");
  /** `enabled` desliga a consulta enquanto ninguém foi escolhido. */
  const query = useSchedulingAvailability(
    { userId, resourceType: "USER" },
    Boolean(userId),
  );

  const create = useCreateSchedulingAvailability();
  const remove = useRemoveSchedulingAvailability();

  const [kind, setKind] = useState<"AVAILABLE" | "BLOCKED">("AVAILABLE");
  /**
   * Semanal ou data específica — o contrato aceita um dos dois, nunca os dois.
   *
   * `validateAvailability` no servidor recusa `date` junto de `dayOfWeek`. Sem a
   * escolha aqui só dava para declarar recorrência semanal, e férias ou um
   * feriado — o caso mais óbvio de bloqueio — não tinham como ser cadastrados.
   */
  const [repeticao, setRepeticao] = useState<"WEEKLY" | "DATE">("WEEKLY");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [date, setDate] = useState("");
  const [start, setStart] = useState("08:00");
  const [end, setEnd] = useState("18:00");
  const [reason, setReason] = useState("");

  const people = members.data?.data ?? [];
  const windows = query.data ?? [];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate(
      {
        resourceType: "USER",
        userId,
        kind,
        ...(repeticao === "WEEKLY"
          ? { dayOfWeek: Number(dayOfWeek) }
          : { date }),
        startMinute: toMinutes(start),
        endMinute: toMinutes(end),
        /** O fuso é o da organização; o backend o exige explicitamente. */
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        reason: reason.trim() || undefined,
      },
      { onSuccess: () => setReason("") },
    );
  };

  return (
    <div className="space-y-5">
      <ManagementBlocked reason={shifts.reason} />
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Janelas de disponibilidade e bloqueio por pessoa. É o que o motor de
          agenda consulta ao detectar conflito.
        </p>
        <p className="text-xs text-muted-foreground">
          A escala declara quando alguém <em>pode</em> trabalhar. Se está
          disponível agora, quem responde é a agenda, cruzando janelas e
          compromissos.
        </p>
      </div>

      <div className="max-w-sm space-y-2">
        <Label htmlFor="shifts-member">Pessoa</Label>
        <Select value={userId} onValueChange={setUserId}>
          <SelectTrigger id="shifts-member">
            <SelectValue placeholder="Selecione uma pessoa" />
          </SelectTrigger>
          <SelectContent>
            {people.map((member) => (
              <SelectItem key={member.userId} value={member.userId}>
                {member.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!userId ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          Selecione uma pessoa para ver e cadastrar as janelas dela.
        </p>
      ) : (
        <>
          <ListState
            isPending={query.isPending}
            error={query.error}
            onRetry={() => void query.refetch()}
            items={windows}
            rows={3}
            empty={{
              icon: <CalendarClock className="size-5" />,
              title: "Nenhuma janela cadastrada",
              description:
                "Sem janela declarada, a agenda considera a pessoa disponível o tempo todo.",
            }}
          >
            {(rows) => (
              <ul className="glass-panel divide-y divide-border rounded-xl">
                {rows.map((window) => (
                  <li
                    key={window.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        window.kind === "BLOCKED" &&
                          "border-destructive/40 text-destructive",
                      )}
                    >
                      {window.kind === "BLOCKED" ? "Bloqueio" : "Disponível"}
                    </Badge>

                    <span className="min-w-0 flex-1 text-sm">
                      {window.dayOfWeek !== null
                        ? WEEKDAYS[window.dayOfWeek]
                        : (window.date ?? "—")}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">
                        {toTime(window.startMinute)}–{toTime(window.endMinute)}
                      </span>
                      {/* O motivo é o que distingue duas janelas iguais — sem
                          ele, "Bloqueio · sábado" pode ser férias ou plantão. */}
                      {window.reason ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {window.reason}
                        </span>
                      ) : null}
                    </span>

                    <span className="font-mono text-xs text-muted-foreground">
                      {window.timezone}
                    </span>

                    {shifts.allowed ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover janela"
                        disabled={remove.isPending}
                        onClick={() => remove.mutate(window.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ListState>

          {shifts.allowed ? (
            <form
              onSubmit={submit}
              className="glass-panel flex flex-wrap items-end gap-3 rounded-xl p-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="shift-kind">Tipo</Label>
                <Select
                  value={kind}
                  onValueChange={(value) =>
                    setKind(value as "AVAILABLE" | "BLOCKED")
                  }
                >
                  <SelectTrigger id="shift-kind" className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AVAILABLE">Disponível</SelectItem>
                    <SelectItem value="BLOCKED">Bloqueio</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="shift-repeat">Quando</Label>
                <Select
                  value={repeticao}
                  onValueChange={(value) =>
                    setRepeticao(value as "WEEKLY" | "DATE")
                  }
                >
                  <SelectTrigger id="shift-repeat" className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKLY">Toda semana</SelectItem>
                    <SelectItem value="DATE">Em uma data</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {repeticao === "WEEKLY" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="shift-day">Dia</Label>
                  <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
                    <SelectTrigger id="shift-day" className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((label, index) => (
                        <SelectItem key={label} value={String(index)}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="shift-date">Data</Label>
                  <Input
                    id="shift-date"
                    type="date"
                    value={date}
                    onChange={(event) => setDate(event.target.value)}
                    className="w-40"
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="shift-start">Das</Label>
                <Input
                  id="shift-start"
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                  className="w-28"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="shift-end">Até</Label>
                <Input
                  id="shift-end"
                  type="time"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                  className="w-28"
                />
              </div>

              <div className="min-w-48 flex-1 space-y-1.5">
                <Label htmlFor="shift-reason">Motivo</Label>
                <Input
                  id="shift-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder={kind === "BLOCKED" ? "Ex.: férias" : "Opcional"}
                />
              </div>

              <Button
                type="submit"
                size="sm"
                disabled={create.isPending || (repeticao === "DATE" && !date)}
              >
                <Plus className="size-4" />
                {create.isPending ? "Salvando…" : "Adicionar"}
              </Button>

              <div className="w-full">
                <MutationError error={create.error ?? remove.error} />
              </div>
            </form>
          ) : null}
        </>
      )}
    </div>
  );
}
