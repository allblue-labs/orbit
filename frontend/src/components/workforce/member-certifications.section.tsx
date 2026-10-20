"use client";

/**
 * Certificações de uma pessoa.
 *
 * ## O vencimento é do servidor
 *
 * `expiryStatus` e `daysUntilExpiry` vêm calculados pelo backend, com o mesmo
 * relógio para todos. A tela não compara datas para decidir se alguém está
 * habilitado — decidir isso no cliente deixaria um navegador com data errada
 * transformar um técnico vencido em habilitado, e habilitação é exatamente o
 * tipo de coisa que não pode depender do relógio de quem olha.
 *
 * ## O formulário é o mesmo da aba da organização
 *
 * Havia aqui um formulário inline com três dos quatro campos do contrato — o
 * número do registro ficou de fora, provavelmente por esquecimento, e ninguém
 * notaria: um campo que não existe no formulário não dá erro. Agora é o
 * `CertificationFormDialog`, o mesmo que a aba Certificações abre, com a pessoa
 * já decidida.
 */
import { useState } from "react";
import { BadgeCheck, Pencil, Plus, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkforceManagement } from "@/hooks/workforce/use-workforce-management";
import {
  useCertifications,
  useRemoveCertification,
} from "@/hooks/workforce/use-workforce";
import type { MemberCertification } from "@/types/workforce";
import { formatDateTime } from "@/lib/formatters";
import { CertificationBadge } from "./certification-badge";
import { CertificationFormDialog } from "./certification-form.dialog";

export function MemberCertificationsSection({ userId }: { userId: string }) {
  const query = useCertifications({ userId });
  const workforce = useWorkforceManagement().workforce;

  /** `null` fechado; `"new"` cadastrando; uma certificação editando. */
  const [editando, setEditando] = useState<MemberCertification | "new" | null>(
    null,
  );
  const remove = useRemoveCertification();

  const items = query.data ?? [];

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <BadgeCheck className="size-4 text-muted-foreground" aria-hidden />
          Certificações
        </h3>
        {workforce.allowed ? (
          <Button variant="ghost" size="sm" onClick={() => setEditando("new")}>
            <Plus className="size-4" />
            Adicionar
          </Button>
        ) : null}
      </div>

      <div className="space-y-3 rounded-xl border border-border p-4">
        {query.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma certificação registrada.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map((certification) => (
              <li
                key={certification.id}
                className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {certification.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {certification.issuer ?? "Emissor não informado"}
                    {certification.expiresAt
                      ? ` · até ${formatDateTime(certification.expiresAt)}`
                      : ""}
                  </p>
                </div>

                <CertificationBadge
                  status={certification.expiryStatus}
                  daysUntilExpiry={certification.daysUntilExpiry}
                />

                {workforce.allowed ? (
                  <>
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
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <MutationError error={remove.error} />
      </div>

      <CertificationFormDialog
        certification={editando === "new" ? null : editando}
        userId={userId}
        open={editando !== null}
        onOpenChange={(open) => {
          if (!open) setEditando(null);
        }}
      />
    </section>
  );
}
