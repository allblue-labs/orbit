"use client";

/**
 * Criação do primeiro calendário.
 *
 * ## Por que existe
 *
 * `CreateEventDto.calendarId` é obrigatório e **nada cria um calendário**: nem
 * o cadastro da organização, nem qualquer tela. Uma organização recém-criada
 * chega à agenda com o seletor vazio e sem saída — foi exatamente o que o
 * banco mostrou: duas das três organizações existentes com zero calendários.
 *
 * O endpoint `POST /scheduling/calendars` já existia desde a PR-07 e não era
 * consumido por ninguém. Este componente o consome; nenhuma regra nova é
 * criada aqui.
 *
 * ## O que o formulário decide e o que não decide
 *
 * Decide os **valores iniciais** (nome sugerido, chave derivada do nome, fuso
 * da unidade ativa). Não decide validade: `key` tem formato validado pelo
 * `@Matches` do DTO, `timezone` por `@IsTimeZone`, e é o backend quem recusa.
 * A recusa aparece como está, sem tradução.
 */
import { useState } from "react";
import { CalendarPlus } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateSchedulingCalendar } from "@/hooks/scheduling/use-scheduling";
import { useSession } from "@/providers/session-provider";
import type { SchedulingCalendar } from "@/types/scheduling";

/**
 * Chave a partir do nome.
 *
 * O DTO exige `^[A-Za-z0-9][A-Za-z0-9_-]{1,99}$`. A derivação remove acento,
 * troca o que não serve por `_` e corta a borda — quem digitou "Equipe de
 * campo" não deveria precisar saber disso.
 */
export function calendarKeyFrom(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);
}

export function CalendarSetup({
  timeZone,
  businessUnitId,
  suggestedName = "Agenda principal",
  isFirst,
  onCreated,
}: {
  timeZone: string;
  businessUnitId?: string;
  suggestedName?: string;
  /** Primeiro calendário da organização — vira o padrão. */
  isFirst: boolean;
  onCreated?: (calendar: SchedulingCalendar) => void;
}) {
  const session = useSession();
  const create = useCreateSchedulingCalendar();
  const [name, setName] = useState(suggestedName);

  const canCreate =
    session.hasPermission("scheduling.calendars.create") &&
    session.hasCapability("scheduling.manage");

  const key = calendarKeyFrom(name);
  const valid = name.trim().length >= 2 && key.length >= 2;

  if (!canCreate) {
    return (
      <p className="text-sm text-muted-foreground">
        Não há calendário nesta organização e o seu acesso não permite criar um.
        Peça a quem administra a conta para criar o primeiro calendário — sem ele não é possível agendar.
      </p>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border p-4">
      <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CalendarPlus className="size-4 text-primary" aria-hidden />
          {isFirst ? "Nenhum calendário nesta organização" : "Novo calendário"}
        </p>
        <p className="text-xs text-muted-foreground">
          Todo agendamento pertence a um calendário. Crie o primeiro para começar.
        </p>
      </div>

      {/*
        O botão alinha pela base do **campo**, não pela da coluna.

        A linha de ajuda (chave e fuso) ficava dentro da coluna do campo, e
        com `items-end` o botão descia para a base dela — 25 pixels abaixo do
        campo, medidos. Ela descreve o que será gravado, então pertence à
        linha de baixo, ocupando a largura toda.
      */}
      <div className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="calendar-name">Nome</Label>
            <Input
              id="calendar-name"
              value={name}
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <Button
            disabled={!valid || create.isPending}
            onClick={() =>
              create.mutate(
                {
                  key,
                  name: name.trim(),
                  timezone: timeZone,
                  businessUnitId,
                  isDefault: isFirst,
                  isActive: true,
                },
                { onSuccess: onCreated },
              )
            }
          >
            {create.isPending ? "Criando…" : "Criar calendário"}
          </Button>
        </div>

        <p className="font-mono text-[11px] text-muted-foreground">
          chave: {key || "—"} · fuso: {timeZone}
        </p>
      </div>

      <MutationError error={create.error} />
    </div>
  );
}
