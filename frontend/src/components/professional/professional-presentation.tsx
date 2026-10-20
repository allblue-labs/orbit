"use client";

/**
 * Como o profissional aparece — papel, credencial e assinatura.
 *
 * Três leituras que a equipe faz o tempo todo e que **não** podem se misturar:
 * o papel diz o que a pessoa faz em campo, a credencial diz o registro que ela
 * possui, e a assinatura diz se ela consegue fechar um documento. Nenhuma das
 * três concede acesso — isso é RBAC, e mora em outro lugar.
 *
 * Reutilizado por Equipe, pelo painel de atribuição do atendimento e, adiante,
 * por PMOC e RVT.
 */
import { BadgeCheck, PenLine, PenOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  credentialLabel,
  credentialTypeName,
  professionalRoleLabel,
  PROFESSIONAL_ROLES,
  signatureStatusLabel,
} from "@/registry";
import type {
  ProfessionalCredential,
  ProfessionalRole,
} from "@/types/workforce";

/**
 * O papel profissional, com o nome que o produto usa.
 *
 * Aparência neutra de propósito. Papel não é situação — colorir "Responsável
 * Técnico" de verde e "Técnico em Campo" de azul sugeriria hierarquia ou
 * estado onde só há descrição de ofício, e gastaria as cores semânticas que a
 * tela reserva para o que exige atenção.
 */
export function ProfessionalRoleBadge({
  role,
  className,
}: {
  role: ProfessionalRole;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant="outline" className={cn("font-normal", className)}>
          {professionalRoleLabel(role)}
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{PROFESSIONAL_ROLES[role]?.description}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Os papéis de um profissional — zero, um ou os dois.
 *
 * Quem acumula os dois recebe os dois rótulos. Não existe "híbrido": somar os
 * papéis num terceiro nome criaria um conceito que o domínio não tem, e que
 * ninguém saberia desfazer depois.
 */
export function ProfessionalRoles({
  roles,
  emptyLabel = "Sem papel profissional",
  className,
}: {
  roles: readonly ProfessionalRole[];
  emptyLabel?: string;
  className?: string;
}) {
  if (roles.length === 0) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {emptyLabel}
      </span>
    );
  }
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {roles.map((role) => (
        <ProfessionalRoleBadge key={role} role={role} />
      ))}
    </span>
  );
}

/**
 * O registro no conselho, resumido.
 *
 * Só o que é administrativo — tipo, número e região. A credencial **não**
 * concede papel: alguém com CREA que o backend não marcou como Responsável
 * Técnico não é Responsável Técnico, e a tela não sugere que seja.
 *
 * O número trunca em vez de esticar a linha; o rótulo completo fica no título.
 */
export function ProfessionalCredentialSummary({
  credential,
  className,
}: {
  credential: ProfessionalCredential | null | undefined;
  className?: string;
}) {
  const label = credentialLabel(credential);

  if (!credential || !label) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        Sem registro profissional
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex max-w-[16rem] items-center gap-1.5 truncate text-xs",
            credential.active ? "text-foreground" : "text-muted-foreground",
            className,
          )}
        >
          <BadgeCheck className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          {credential.active ? null : (
            <span className="shrink-0 text-muted-foreground">(revogado)</span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {credentialTypeName(credential.type)}
        {credential.issuingAuthority ? ` · ${credential.issuingAuthority}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Assinatura cadastrada, ou não.
 *
 * Estado administrativo, não alarme: quem entrou esta semana ainda não tem, e
 * isso é normal. O que a tela evita é a descoberta tardia — na hora de emitir
 * o documento, quando já não dá para resolver.
 *
 * O arquivo em si nunca aparece aqui. O contrato publica um booleano
 * justamente para que a assinatura de alguém não circule pela interface.
 */
export function ProfessionalSignatureStatus({
  available,
  className,
}: {
  available: boolean;
  className?: string;
}) {
  const Icon = available ? PenLine : PenOff;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs",
        available ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {signatureStatusLabel(available)}
    </span>
  );
}

/** Perfil profissional ativo ou inativo — distinto de usuário desativado. */
export function ProfessionalStatus({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  if (active) return null;
  return (
    <Badge variant="secondary" className={cn("font-normal", className)}>
      Perfil inativo
    </Badge>
  );
}
