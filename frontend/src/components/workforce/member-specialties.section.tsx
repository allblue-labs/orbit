"use client";

/**
 * Especialidades de uma pessoa.
 *
 * O catálogo de especialidades é da organização; aqui a pessoa é vinculada a
 * ele com um **nível declarado**. Declarado é a palavra: nada é inferido de
 * volume de trabalho ou tempo de casa — quem define é quem gere a equipe.
 */
import { useState } from "react";
import { Award, Plus, X } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import {
  useAssignSpecialty,
  useMemberSpecialties,
  useSpecialties,
  useUnassignSpecialty,
} from "@/hooks/workforce/use-workforce";
import { cn } from "@/lib/utils";
import { SpecialtyLevel } from "@/types/workforce";

const LEVEL_LABELS: Readonly<Record<string, string>> = {
  JUNIOR: "Júnior",
  PLENO: "Pleno",
  SENIOR: "Sênior",
  ESPECIALISTA: "Especialista",
};

export function MemberSpecialtiesSection({ userId }: { userId: string }) {
  const assigned = useMemberSpecialties(userId);
  const catalog = useSpecialties();
  const workforce = useWorkforceManagement().workforce;

  const assign = useAssignSpecialty(userId);
  const unassign = useUnassignSpecialty(userId);

  const [specialtyId, setSpecialtyId] = useState("");
  const [level, setLevel] = useState<string>(SpecialtyLevel.PLENO);

  const items = assigned.data ?? [];
  const taken = new Set(items.map((item) => item.specialty.id));
  const available = (catalog.data ?? []).filter(
    (specialty) => !taken.has(specialty.id),
  );

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Award className="size-4 text-muted-foreground" aria-hidden />
        Especialidades
      </h3>

      <div className="space-y-3 rounded-xl border border-border p-4">
        {assigned.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma especialidade registrada.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs",
                    item.specialty.color,
                  )}
                >
                  {item.specialty.name}
                  <Badge variant="secondary" className="text-[10px]">
                    {LEVEL_LABELS[item.level] ?? item.level}
                  </Badge>
                  {workforce.allowed ? (
                    <button
                      type="button"
                      onClick={() => unassign.mutate(item.specialty.id)}
                      disabled={unassign.isPending}
                      aria-label={`Remover ${item.specialty.name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3" />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}

        {workforce.allowed && available.length > 0 ? (
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <Select value={specialtyId} onValueChange={setSpecialtyId}>
              <SelectTrigger className="w-52" aria-label="Especialidade">
                <SelectValue placeholder="Especialidade" />
              </SelectTrigger>
              <SelectContent>
                {available.map((specialty) => (
                  <SelectItem key={specialty.id} value={specialty.id}>
                    {specialty.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-36" aria-label="Nível">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(SpecialtyLevel).map((value) => (
                  <SelectItem key={value} value={value}>
                    {LEVEL_LABELS[value] ?? value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              size="sm"
              disabled={!specialtyId || assign.isPending}
              onClick={() =>
                assign.mutate(
                  { specialtyId, level: level as SpecialtyLevel },
                  { onSuccess: () => setSpecialtyId("") },
                )
              }
            >
              <Plus className="size-4" />
              Adicionar
            </Button>
          </div>
        ) : null}

        {workforce.allowed && catalog.data?.length === 0 ? (
          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            O catálogo de especialidades está vazio. Cadastre na aba
            Especialidades.
          </p>
        ) : null}

        <MutationError error={assign.error ?? unassign.error} />
      </div>
    </section>
  );
}
