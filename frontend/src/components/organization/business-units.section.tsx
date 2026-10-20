"use client";

/**
 * Organizações.
 *
 * ## O nome no produto e o nome no código
 *
 * O produto chama isto de **organização**; o banco, o contrato da API e todo
 * identificador deste arquivo continuam chamando de `BusinessUnit`. A troca foi
 * de vocabulário, não de conceito: renomear a tabela e as rotas quebraria
 * clientes publicados para resolver uma questão de palavra.
 *
 * Cuidado ao ler: "organização" tem dois donos agora. A conta (`Organization`,
 * o inquilino) e isto aqui, que vive dentro dela. Onde os dois aparecem juntos
 * — a barra lateral — o de cima é a conta.
 *
 * ## O que o contrato suporta, e o que não
 *
 * | Ação | Endpoint | Situação |
 * | --- | --- | --- |
 * | Listar | `GET /organizations/current/business-units` | ✓ exige `business_units.read` |
 * | Criar | `POST …` | ✓ |
 * | Editar | `PATCH …` | ✓ — mas só os campos de `CreateBusinessUnitDto` |
 * | Ativar/desativar | — | **não existe**: `status` é publicado na leitura e **não** aceito no `PartialType(CreateBusinessUnitDto)` |
 * | Remover | `DELETE …` | ✓ |
 * | Trocar unidade ativa | — | **não existe** no backend; o escopo ativo é local |
 *
 * Ativação e desativação não são oferecidas como botão: a única forma de tirar
 * uma unidade de circulação hoje é removê-la, que é outra coisa. Um botão
 * "desativar" que envia `status` receberia 400 —
 * `property status should not exist`.
 *
 * ## Unidade ativa
 *
 * O backend deriva a organização das claims do token e **não expõe rota para
 * trocar a unidade ativa**. O escopo ativo do frontend (`useActiveScope`) é
 * uma preferência local que entra como filtro (`businessUnitId`) nas consultas
 * que o aceitam — e é assim que ele é apresentado aqui: seleção de contexto de
 * trabalho, não mudança de sessão.
 */
import { useState } from "react";
import { Building2, Check, MapPin, Pencil, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useBusinessUnits,
  useRemoveBusinessUnit,
} from "@/hooks/organization/use-organization";
import { BusinessUnitFormDialog } from "./business-unit-form.dialog";
import { useActiveScope } from "@/providers/use-active-scope";
import { lifecycleLabel } from "@/registry";
import { cn } from "@/lib/utils";
import type { BusinessUnit } from "@/types/organization";

export function BusinessUnitsSection({ canManage }: { canManage: boolean }) {
  const units = useBusinessUnits();
  const remove = useRemoveBusinessUnit();
  const { businessUnitId, switchBusinessUnit } = useActiveScope();

  /** `null` fechado; `"new"` criando; uma unidade editando. */
  const [editando, setEditando] = useState<BusinessUnit | "new" | null>(null);

  return (
    <PanelFrame
      panelId="organization-business-units"
      title="Organizações"
      description="Filiais, sedes e departamentos da sua conta"
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setEditando("new")}>
            <Plus className="size-3.5" />
            Nova unidade
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <PanelState
          query={toPanelQuery(units)}
          loadingRows={3}
          isEmpty={(data) => data.length === 0}
          emptyMessage="Nenhuma organização cadastrada."
        >
          {(data) => (
            <ul className="space-y-2">
              {data.map((unit) => (
                <UnitRow
                  key={unit.id}
                  unit={unit}
                  active={unit.id === businessUnitId}
                  canManage={canManage}
                  removing={remove.isPending}
                  onSelect={() => switchBusinessUnit(unit.id)}
                  onEdit={() => setEditando(unit)}
                  onRemove={() => remove.mutate(unit.id)}
                />
              ))}
            </ul>
          )}
        </PanelState>

        <MutationError error={remove.error} />

        <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <p>
            <strong>Ativar e desativar não existem no contrato.</strong> O campo{" "}
            <code>status</code> é publicado na leitura, mas
            <code> UpdateBusinessUnitDto</code> não o aceita.
          </p>
          <p>
            <strong>Trocar a unidade ativa é local.</strong> O escopo vem da sua sessão e não pode ser trocado por aqui; a seleção acima muda o filtro <code>businessUnitId</code> das consultas que o
            aceitam, não a sessão.
          </p>
        </div>
      </div>

      <BusinessUnitFormDialog
        unit={editando === "new" ? null : editando}
        open={editando !== null}
        onOpenChange={(open) => {
          if (!open) setEditando(null);
        }}
      />
    </PanelFrame>
  );
}

function UnitRow({
  unit,
  active,
  canManage,
  removing,
  onSelect,
  onEdit,
  onRemove,
}: {
  unit: BusinessUnit;
  active: boolean;
  canManage: boolean;
  removing: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2",
        active ? "border-primary/60 bg-primary/5" : "border-border",
      )}
    >
      <Building2
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden
      />

      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {unit.tradeName ?? unit.legalName}
          {unit.isPrimary ? (
            <Badge variant="secondary" className="text-[10px]">
              principal
            </Badge>
          ) : null}
          <Badge variant="outline" className="text-[10px]">
            {unit.type}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {lifecycleLabel(unit.status)}
          </Badge>
        </p>
        <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="size-3" aria-hidden />
          {unit.city}
          {unit.stateCode ? `/${unit.stateCode}` : ""} · {unit.timezone} ·{" "}
          {unit.currency}
          <span className="font-mono">{unit.documentNumber}</span>
        </p>
      </div>

      <Button
        size="sm"
        variant={active ? "default" : "outline"}
        onClick={onSelect}
        disabled={active}
      >
        {active ? <Check className="size-3.5" /> : null}
        {active ? "Contexto atual" : "Trabalhar nesta"}
      </Button>

      {canManage ? (
        <Button
          size="icon"
          variant="ghost"
          className="size-8"
          onClick={onEdit}
          aria-label={`Editar ${unit.tradeName ?? unit.legalName}`}
        >
          <Pencil className="size-4" />
        </Button>
      ) : null}

      {/* A principal não some: sem ela a organização fica sem unidade de
          referência, e o servidor recusaria de qualquer forma. */}
      {canManage && !unit.isPrimary ? (
        <Button
          size="icon"
          variant="ghost"
          className="size-8 text-destructive"
          disabled={removing}
          onClick={onRemove}
          aria-label={`Remover ${unit.tradeName ?? unit.legalName}`}
        >
          <Trash2 className="size-4" />
        </Button>
      ) : null}
    </li>
  );
}
