"use client";

/**
 * Quem atua profissionalmente, por papel.
 *
 * ## De onde vem a lista
 *
 * Dos dois seletores do backend — `GET /workforce/field-technicians` e
 * `GET /workforce/eligible-technical-responsibles`. Estar em uma lista **é** a
 * declaração do servidor de que a pessoa tem aquele papel; quem aparece nas
 * duas tem os dois, e recebe os dois rótulos.
 *
 * Não há endpoint que liste todos os perfis profissionais de uma vez, e
 * montá-lo aqui com uma consulta por membro seria um N+1 numa tela de
 * listagem. Duas consultas resolvem, e a união é leitura do contrato — não
 * inferência.
 *
 * ## O que esta aba não mostra
 *
 * Perfis **inativos**: os seletores devolvem apenas ativos, porque servem para
 * escolher quem pode assumir trabalho. O perfil completo — inclusive inativo,
 * e inclusive de quem não tem papel nenhum — está no detalhe de cada membro,
 * em "Perfil profissional".
 *
 * ## Papel profissional não é papel de acesso
 *
 * A aba **Usuários** mostra RBAC: o que a pessoa pode fazer no sistema. Esta
 * mostra ofício: o que ela faz em campo. As duas coexistem sem se sobrepor.
 */
import { useMemo } from "react";
import { HardHat } from "lucide-react";

import {
  ProfessionalCredentialSummary,
  ProfessionalRoles,
  ProfessionalSignatureStatus,
} from "@/components/professional/professional-presentation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useFieldTechnicians,
  useTechnicalResponsibles,
} from "@/hooks/workforce/use-workforce";
import { useActiveScope } from "@/providers/use-active-scope";
import type { EligibleProfessional, ProfessionalRole } from "@/types/workforce";
import { ListState, ResultSummary, SearchField } from "@/workspace";
import { useState } from "react";

interface ProfessionalRow extends EligibleProfessional {
  roles: readonly ProfessionalRole[];
}

/** Une os dois seletores por pessoa, somando os papéis. */
function merge(
  fieldTechnicians: readonly EligibleProfessional[] | undefined,
  technicalResponsibles: readonly EligibleProfessional[] | undefined,
): ProfessionalRow[] {
  const rows = new Map<string, ProfessionalRow>();

  const add = (
    people: readonly EligibleProfessional[] | undefined,
    role: ProfessionalRole,
  ) => {
    for (const person of people ?? []) {
      const existing = rows.get(person.id);
      if (existing) {
        rows.set(person.id, { ...existing, roles: [...existing.roles, role] });
      } else {
        rows.set(person.id, { ...person, roles: [role] });
      }
    }
  };

  add(fieldTechnicians, "FIELD_TECHNICIAN");
  add(technicalResponsibles, "TECHNICAL_RESPONSIBLE");

  return [...rows.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR"),
  );
}

export function ProfessionalsTab() {
  const { businessUnitId } = useActiveScope();
  const scope = businessUnitId ? { businessUnitId } : undefined;

  const fieldTechnicians = useFieldTechnicians(scope);
  const technicalResponsibles = useTechnicalResponsibles(scope);
  const [search, setSearch] = useState("");

  const rows = useMemo(
    () => merge(fieldTechnicians.data, technicalResponsibles.data),
    [fieldTechnicians.data, technicalResponsibles.data],
  );

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    /** Busca sobre o que já veio — o seletor do backend não recebe termo. */
    return rows.filter((row) => row.name.toLowerCase().includes(term));
  }, [rows, search]);

  const isPending =
    fieldTechnicians.isPending || technicalResponsibles.isPending;
  const error = fieldTechnicians.error ?? technicalResponsibles.error;

  return (
    <div className="space-y-4">
      <SearchField
        id="professionals-search"
        value={search}
        onChange={setSearch}
        label="Buscar"
        placeholder="Nome do profissional"
        hint="Busca sobre os profissionais desta unidade."
      />

      <ResultSummary
        meta={
          isPending
            ? undefined
            : {
                page: 1,
                limit: filtered.length || 1,
                total: filtered.length,
                totalPages: 1,
                hasNextPage: false,
                hasPreviousPage: false,
              }
        }
        noun="profissional"
        note="Perfis ativos com papel profissional na unidade em contexto."
      />

      <ListState
        isPending={isPending}
        error={error}
        onRetry={() => {
          void fieldTechnicians.refetch();
          void technicalResponsibles.refetch();
        }}
        items={filtered}
        empty={{
          icon: <HardHat className="size-5" />,
          title: "Nenhum profissional nesta unidade",
          description:
            "Papéis profissionais são cadastrados no perfil de cada membro, separadamente do acesso ao sistema.",
        }}
      >
        {(people) => (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profissional</TableHead>
                  <TableHead>Papéis</TableHead>
                  <TableHead>Registro</TableHead>
                  <TableHead>Assinatura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {people.map((person) => (
                  <TableRow key={person.id}>
                    <TableCell className="font-medium">{person.name}</TableCell>
                    <TableCell>
                      <ProfessionalRoles roles={person.roles} />
                    </TableCell>
                    <TableCell>
                      <ProfessionalCredentialSummary
                        credential={person.professionalCredential}
                      />
                    </TableCell>
                    <TableCell>
                      <ProfessionalSignatureStatus
                        available={person.signatureAvailable}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>
    </div>
  );
}
