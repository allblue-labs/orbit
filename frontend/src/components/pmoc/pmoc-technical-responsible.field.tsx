"use client";

import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROUTES } from "@/lib/routes";
import { PROFESSIONAL_ROLES } from "@/registry";
import {
  avisoDoResponsavelTecnico,
  type CandidatoRT,
} from "./pmoc-technical-responsible";

export function PmocTechnicalResponsibleField({
  id,
  value,
  onChange,
  candidates,
  isPending,
  error,
  onRetry,
  currentName,
}: {
  id: string;
  value: string;
  onChange: (id: string) => void;
  candidates: readonly CandidatoRT[];
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  currentName?: string;
}) {
  const unavailable =
    Boolean(value) && !candidates.some((item) => item.id === value);
  const warning = avisoDoResponsavelTecnico(candidates, value);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/20 p-4">
      <Label htmlFor={id}>
        {PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.label}{" "}
        <span aria-hidden="true">*</span>
        <span className="sr-only"> (obrigatório)</span>
      </Label>
      <Select
        value={value}
        onValueChange={onChange}
        disabled={isPending || Boolean(error) || candidates.length === 0}
        required
      >
        <SelectTrigger
          id={id}
          aria-required="true"
          aria-describedby={`${id}-description`}
        >
          <SelectValue placeholder="Selecione o Responsável Técnico" />
        </SelectTrigger>
        <SelectContent>
          {unavailable ? (
            <SelectItem value={value} disabled>
              {currentName ?? "Responsável selecionado"} — indisponível
            </SelectItem>
          ) : null}
          {candidates.map((person) => (
            <SelectItem key={person.id} value={person.id}>
              {person.name}
              {person.signatureAvailable ? "" : " — sem assinatura"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p
        id={`${id}-description`}
        className="text-xs leading-relaxed text-muted-foreground"
      >
        Responde tecnicamente pelo contrato. A execução de cada atendimento pode
        ser atribuída a outro técnico em campo.
      </p>
      {isPending ? (
        <p
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          <Loader2 className="size-3.5 animate-spin" /> Carregando responsáveis
          técnicos…
        </p>
      ) : error ? (
        <div role="alert" className="space-y-2 text-sm">
          <p>
            Não foi possível carregar os responsáveis técnicos desta unidade.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Tentar novamente
          </Button>
        </div>
      ) : warning ? (
        <p className="text-xs leading-relaxed text-warning">{warning.texto}</p>
      ) : null}
      {!isPending && !error && candidates.length === 0 ? (
        <Button asChild variant="link" size="sm" className="h-auto px-0">
          <Link href={ROUTES.team}>Configurar responsável na Equipe</Link>
        </Button>
      ) : null}
    </div>
  );
}
