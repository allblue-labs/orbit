"use client";

/**
 * Certificações da organização inteira.
 *
 * A pergunta que esta aba responde é "quem está com habilitação vencendo" —
 * por isso ordena por vencimento e oferece o recorte por prazo, que é **do
 * servidor** (`?expiringWithinDays=`).
 *
 * O vencimento vem calculado pelo backend, com o mesmo relógio para todos:
 * habilitação não pode depender da data do navegador de quem olha.
 */
import { useState } from "react";
import { BadgeCheck, Pencil, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserReference } from "@/components/identity/user-reference";
import {
  useCertifications,
  useRemoveCertification,
} from "@/hooks/workforce/use-workforce";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import { ManagementBlocked } from "../management-blocked";
import type { MemberCertification } from "@/types/workforce";
import { formatDateTime } from "@/lib/formatters";
import {
  FilterBar,
  FilterSelect,
  ListState,
  useListController,
} from "@/workspace";
import { CertificationBadge } from "../certification-badge";
import { CertificationFormDialog } from "../certification-form.dialog";

interface CertificationFilters {
  expiringWithinDays?: number;
  page?: number;
  limit?: number;
}

/** Recortes de prazo que o backend aceita. */
const WINDOW_OPTIONS = [
  { value: "30", label: "Vencendo em 30 dias" },
  { value: "60", label: "Vencendo em 60 dias" },
  { value: "90", label: "Vencendo em 90 dias" },
  { value: "0", label: "Já vencidas" },
];

export function CertificationsTab() {
  const list = useListController<CertificationFilters>();
  const workforce = useWorkforceManagement().workforce;

  /** `null` fechado; `"new"` cadastrando; uma certificação editando. */
  const [editando, setEditando] = useState<MemberCertification | "new" | null>(
    null,
  );
  const remove = useRemoveCertification();

  const window = list.query.expiringWithinDays;
  const query = useCertifications(
    window === undefined ? undefined : { expiringWithinDays: window },
  );

  const items = query.data ?? [];

  return (
    <div className="space-y-5">
      <ManagementBlocked reason={workforce.reason} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Habilitações da equipe, ordenadas por vencimento. O prazo não depende
          do relógio deste navegador.
        </p>
        {workforce.allowed ? (
          <Button size="sm" onClick={() => setEditando("new")}>
            <Plus className="size-4" />
            Nova certificação
          </Button>
        ) : null}
      </div>

      <MutationError error={remove.error} />

      <FilterBar onClear={list.reset} canClear={list.isFiltered}>
        <FilterSelect
          id="certifications-window"
          label="Prazo"
          value={window === undefined ? undefined : String(window)}
          onChange={(value) =>
            list.setFilter(
              "expiringWithinDays",
              value === undefined ? undefined : Number(value),
            )
          }
          options={WINDOW_OPTIONS}
          anyLabel="Todas"
        />
      </FilterBar>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={items}
        empty={{
          icon: <BadgeCheck className="size-5" />,
          title: list.isFiltered
            ? "Nenhuma certificação neste prazo"
            : "Nenhuma certificação registrada",
          description:
            "Cadastre aqui ou no detalhe de cada pessoa, na aba Usuários — é o mesmo registro.",
          action: workforce.allowed ? (
            <Button size="sm" onClick={() => setEditando("new")}>
              <Plus className="size-4" />
              Nova certificação
            </Button>
          ) : undefined,
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Certificação</TableHead>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Emissor</TableHead>
                  <TableHead>Validade</TableHead>
                  <TableHead>Situação</TableHead>
                  {workforce.allowed ? (
                    <TableHead className="text-right">Ações</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((certification) => (
                  <TableRow key={certification.id}>
                    <TableCell>
                      <p className="font-medium">{certification.name}</p>
                      {certification.credentialId ? (
                        <p className="font-mono text-xs text-muted-foreground">
                          {certification.credentialId}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <UserReference userId={certification.userId} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {certification.issuer ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {certification.expiresAt ? (
                        formatDateTime(certification.expiresAt)
                      ) : (
                        <Badge variant="secondary">sem prazo</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <CertificationBadge
                        status={certification.expiryStatus}
                        daysUntilExpiry={certification.daysUntilExpiry}
                      />
                    </TableCell>
                    {workforce.allowed ? (
                      <TableCell className="text-right whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Editar ${certification.name}`}
                          onClick={() => setEditando(certification)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remover ${certification.name}`}
                          disabled={remove.isPending}
                          onClick={() => remove.mutate(certification.id)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <CertificationFormDialog
        certification={editando === "new" ? null : editando}
        open={editando !== null}
        onOpenChange={(open) => {
          if (!open) setEditando(null);
        }}
      />
    </div>
  );
}
