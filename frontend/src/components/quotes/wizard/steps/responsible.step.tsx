"use client";

/**
 * Passo 5 — quem responde e assina.
 *
 * ## O padrão é quem está usando o sistema
 *
 * Quem monta a proposta normalmente é quem responde por ela. Começar vazio faria
 * todo orçamento pedir uma escolha cuja resposta é quase sempre a mesma.
 *
 * ## A tela avisa quem não tem assinatura, e não impede
 *
 * A listagem de membros publica **se** há assinatura ativa — só o fato, nunca a
 * imagem: quem escolhe precisa saber se o documento sairá assinado, e espalhar a
 * assinatura de outra pessoa pelo navegador não responderia nada a mais.
 *
 * Sem assinatura, o documento sai com a linha em branco para assinar à mão, que é
 * o que o papel sempre permitiu. Bloquear aqui prenderia a emissão a uma
 * configuração de perfil — e é exatamente nas urgências que ela não está feita.
 */
import { PenLine, TriangleAlert } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useOrganizationMembers } from "@/hooks/organization/use-organization";
import { cn } from "@/lib/utils";
import type { QuoteDraft } from "../quote-wizard.model";

export function ResponsibleStep({
  draft,
  onChange,
}: {
  draft: QuoteDraft;
  onChange: (patch: Partial<QuoteDraft>) => void;
}) {
  const members = useOrganizationMembers();
  const people = members.data?.data ?? [];

  if (members.isPending) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }

  const chosen = people.find(
    (person) => person.userId === draft.responsibleUserId,
  );

  return (
    <div className="space-y-4">
      <ul className="max-h-80 space-y-2 overflow-y-auto">
        {people.map((person) => {
          const selected = person.userId === draft.responsibleUserId;
          return (
            <li key={person.userId}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ responsibleUserId: person.userId })}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent/50",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {person.displayName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {person.role.name} · {person.email}
                  </span>
                </span>

                {person.hasSignature ? (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-emerald-400">
                    <PenLine className="size-3.5" aria-hidden />
                    assinatura cadastrada
                  </span>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-amber-400">
                    <TriangleAlert className="size-3.5" aria-hidden />
                    sem assinatura
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {chosen && !chosen.hasSignature ? (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <strong className="font-medium">{chosen.displayName}</strong> não tem
          assinatura cadastrada. A proposta sai com a linha em branco para
          assinar à mão — dá para cadastrar a assinatura no próprio perfil e
          reemitir depois.
        </p>
      ) : null}
    </div>
  );
}
