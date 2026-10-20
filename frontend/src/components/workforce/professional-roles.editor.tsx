"use client";

/**
 * Ligar e desligar os papéis profissionais de um membro.
 *
 * ## A superfície que faltava
 *
 * A seção do perfil era somente leitura, com um comentário dizendo que editar
 * "exige endpoints próprios que ainda não têm superfície Web". Os endpoints
 * existiam desde o domínio profissional — faltava a tela. E a consequência não
 * era estética: **sem perfil de técnico de campo a pessoa não pode ser atribuída
 * a um atendimento** (`validateTechnicianAssignments` recusa), não aparece na
 * lista de técnicos e não ganha comissão. Dava para cadastrar um membro com o
 * papel de acesso "Técnico Operacional" e ele continuar invisível para a operação.
 *
 * ## Papel de acesso e papel profissional são coisas diferentes
 *
 * O papel RBAC diz o que a pessoa pode fazer **no sistema**; o papel profissional
 * diz o que ela faz **em campo**. Um gestor com acesso total pode não ter
 * nenhum; um responsável técnico pode ter acesso mínimo. Esta tela mexe só no
 * segundo, e o texto diz isso — juntar os dois num crachá de "Técnico" é o erro
 * que o domínio profissional existe para evitar.
 *
 * ## Os dois papéis viajam juntos
 *
 * O contrato **substitui** os dois valores. Enviar só o que mudou apagaria o
 * outro, então o formulário parte do estado atual e manda os dois.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useUpdateProfessionalProfile } from "@/hooks/workforce/use-workforce";
import { PROFESSIONAL_ROLES } from "@/registry";
import type { ProfessionalProfile } from "@/types/workforce";

export function ProfessionalRolesEditor({
  userId,
  profile,
  canManage,
}: {
  userId: string;
  /** `null` quando o membro ainda não tem perfil — o primeiro salvamento o cria. */
  profile: ProfessionalProfile | null;
  canManage: boolean;
}) {
  const atualizar = useUpdateProfessionalProfile(userId);

  const [campo, setCampo] = useState(
    profile?.professionalRoles.includes("FIELD_TECHNICIAN") ?? false,
  );
  const [responsavel, setResponsavel] = useState(
    profile?.professionalRoles.includes("TECHNICAL_RESPONSIBLE") ?? false,
  );
  const [ativo, setAtivo] = useState(profile?.active ?? true);

  if (!canManage) {
    return (
      <p className="text-xs text-muted-foreground">
        Alterar papéis profissionais exige permissão para administrar a equipe.
      </p>
    );
  }

  const salvar = () =>
    atualizar.mutate({
      fieldTechnicianEnabled: campo,
      technicalResponsibleEnabled: responsavel,
      active: ativo,
    });

  const mudou =
    campo !==
      (profile?.professionalRoles.includes("FIELD_TECHNICIAN") ?? false) ||
    responsavel !==
      (profile?.professionalRoles.includes("TECHNICAL_RESPONSIBLE") ?? false) ||
    ativo !== (profile?.active ?? true);

  return (
    <div className="space-y-3 border-t border-border pt-3">
      <Alternador
        id="perfil-tecnico-campo"
        titulo={PROFESSIONAL_ROLES.FIELD_TECHNICIAN.label}
        descricao="Pode ser atribuído a um atendimento e receber comissão."
        marcado={campo}
        onChange={setCampo}
      />

      <Alternador
        id="perfil-responsavel-tecnico"
        titulo={PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.label}
        descricao={PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.description}
        marcado={responsavel}
        onChange={setResponsavel}
      />

      <Alternador
        id="perfil-ativo"
        titulo="Perfil ativo"
        descricao="Desativado, a pessoa deixa de ser oferecida para atribuição — sem perder o histórico."
        marcado={ativo}
        onChange={setAtivo}
      />

      <MutationError error={atualizar.error} />

      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!mudou || atualizar.isPending}
          onClick={salvar}
        >
          {atualizar.isPending ? "Salvando…" : "Salvar papéis"}
        </Button>
      </div>
    </div>
  );
}

function Alternador({
  id,
  titulo,
  descricao,
  marcado,
  onChange,
}: {
  id: string;
  titulo: string;
  descricao: string;
  marcado: boolean;
  onChange: (valor: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-start justify-between gap-3">
      <span className="min-w-0">
        <span className="block text-sm font-medium">{titulo}</span>
        <span className="block text-xs text-muted-foreground">{descricao}</span>
      </span>
      <Switch id={id} checked={marcado} onCheckedChange={onChange} />
    </label>
  );
}
