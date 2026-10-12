"use client";

/**
 * Escolher um profissional — com o elenco que o servidor decidiu.
 *
 * ## A elegibilidade não é calculada aqui
 *
 * `GET /workforce/field-technicians` e
 * `GET /workforce/eligible-technical-responsibles` já devolvem só quem pode:
 * perfil ativo, papel habilitado, usuário ativo na organização e atuando na
 * unidade do atendimento. A tela mostra o que voltou.
 *
 * Filtrar de novo no navegador seria refazer a regra com metade da informação
 * — e a metade que falta é justamente a que muda: vínculo de unidade, perfil
 * desativado ontem, papel removido hoje.
 *
 * ## Dois seletores, não um com parâmetro
 *
 * Técnico em Campo e Responsável Técnico são consultas diferentes no backend
 * porque são perguntas diferentes. Um seletor único com uma prop `role`
 * convidaria a reutilizar a resposta de um no outro, que é exatamente o erro
 * que o domínio separa.
 */
import { useMemo, useState } from "react";

import { PanelError } from "@/components/panels";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/feedback/states";
import {
  useFieldTechnicians,
  useTechnicalResponsibles,
} from "@/hooks/workforce/use-workforce";
import type { ApiError } from "@/lib/api-error";
import type { EligibleProfessional } from "@/types/workforce";
import {
  ProfessionalCredentialSummary,
  ProfessionalSignatureStatus,
} from "./professional-presentation";

interface SelectorProps {
  /** A unidade do atendimento. O servidor recorta os candidatos por ela. */
  businessUnitId?: string;
  /**
   * Quem já está na equipe.
   *
   * Some da lista para não oferecer o que resultaria em duplicidade — mas a
   * regra continua sendo do servidor: ele recusa a repetição de qualquer
   * forma, e é a recusa dele que a tela exibe se algo escapar.
   */
  excludeUserIds?: readonly string[];
  placeholder?: string;
  emptyLabel: string;
  disabled?: boolean;
  onSelect: (professional: EligibleProfessional) => void;
  children: React.ReactNode;
}

function ProfessionalPicker({
  candidates,
  isPending,
  error,
  onRetry,
  excludeUserIds = [],
  placeholder = "Buscar profissional…",
  emptyLabel,
  disabled,
  onSelect,
  children,
}: Omit<SelectorProps, "businessUnitId"> & {
  candidates: readonly EligibleProfessional[] | undefined;
  isPending: boolean;
  error: ApiError | null;
  onRetry: () => void;
}) {
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () =>
      (candidates ?? []).filter(
        (candidate) => !excludeUserIds.includes(candidate.id),
      ),
    [candidates, excludeUserIds],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-[22rem] p-0" align="start">
        {error ? (
          <div className="p-4">
            <PanelError error={error} onRetry={onRetry} />
          </div>
        ) : (
          <Command
            /**
             * A busca é local sobre a lista que o servidor devolveu.
             *
             * O contrato do seletor não recebe termo de busca, e o elenco de
             * uma unidade cabe numa resposta. Inventar `?search=` produziria
             * 404; paginar o que não pagina, um parâmetro ignorado.
             */
            filter={(value, search) =>
              value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder={placeholder} />
            <CommandList>
              {isPending ? (
                <div className="flex items-center justify-center py-6">
                  <Spinner label="Carregando profissionais…" />
                </div>
              ) : (
                <>
                  <CommandEmpty>{emptyLabel}</CommandEmpty>
                  <CommandGroup>
                    {available.map((candidate) => (
                      <CommandItem
                        key={candidate.id}
                        value={candidate.name}
                        onSelect={() => {
                          onSelect(candidate);
                          setOpen(false);
                        }}
                        className="flex-col items-start gap-1"
                      >
                        <span className="font-medium">{candidate.name}</span>
                        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <ProfessionalCredentialSummary
                            credential={candidate.professionalCredential}
                          />
                          <ProfessionalSignatureStatus
                            available={candidate.signatureAvailable}
                          />
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Escolhe quem executa o atendimento. */
export function FieldTechnicianSelector({
  businessUnitId,
  ...props
}: SelectorProps) {
  const query = useFieldTechnicians(
    businessUnitId ? { businessUnitId } : undefined,
  );
  return (
    <ProfessionalPicker
      {...props}
      candidates={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    />
  );
}

/** Escolhe quem responde tecnicamente pelo documento. */
export function TechnicalResponsibleSelector({
  businessUnitId,
  ...props
}: SelectorProps) {
  const query = useTechnicalResponsibles(
    businessUnitId ? { businessUnitId } : undefined,
  );
  return (
    <ProfessionalPicker
      {...props}
      candidates={query.data}
      isPending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    />
  );
}

/** Frase padrão quando a unidade não tem ninguém elegível. */
export const NO_FIELD_TECHNICIAN =
  "Nenhum Técnico em Campo elegível foi encontrado para esta organização.";
export const NO_TECHNICAL_RESPONSIBLE =
  "Nenhum Responsável Técnico elegível foi encontrado para esta organização.";

/** Um índice de barril para quem só quer os dois seletores. */
export const PROFESSIONAL_SELECTOR_EMPTY = {
  FIELD_TECHNICIAN: NO_FIELD_TECHNICIAN,
  TECHNICAL_RESPONSIBLE: NO_TECHNICAL_RESPONSIBLE,
} as const;
