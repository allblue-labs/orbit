"use client";

/**
 * As ações do plano: editar e mudar de estado.
 *
 * ## O lifecycle vem do servidor
 *
 * `allowedTransitions` é publicado no detalhe do plano — a máquina de estados
 * já resolvida para a situação atual. É ela que decide quais botões existem.
 *
 * Deduzir `status === "DRAFT" → pode ativar` reconstruiria no navegador a
 * regra que o servidor publica pronta, e ela envelheceria na primeira mudança
 * do domínio. É a mesma doutrina da PR-FE-01, aplicada ao PMOC.
 *
 * ## Baixar o contrato não é administrar
 *
 * O relatório de configuração exige `pmoc.read`, e por isso o botão fica **fora**
 * do portão de `pmoc.manage`: quem só consulta o plano tem direito ao contrato
 * impresso. Dentro do portão, o componente inteiro desaparecia para essa pessoa —
 * e com ele um documento que o servidor entrega.
 *
 * ## Editar não tem autoridade publicada
 *
 * O backend recusa edição de plano encerrado ou cancelado
 * (`EDITABLE_STATUSES`), mas **não publica** isso em nenhum campo. Então a
 * ação segue pela permissão — como `operations.delete` na PR-FE-02 — e a
 * recusa do servidor é exibida como veio. Registrado como lacuna em
 * `docs/pmoc-v2-web.md`.
 */
import { useState } from "react";
import { FileDown, Loader2, MoreHorizontal, Pencil } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useActivatePmocPlan,
  useCancelPmocPlan,
  usePmocPlanDocument,
  useSuspendPmocPlan,
} from "@/hooks/pmoc/use-pmoc";
import { useSession } from "@/providers/session-provider";
import type { PmocPlan } from "@/types/pmoc";
import { PmocPlanEditDialog } from "./pmoc-plan-edit.dialog";

/**
 * Cada transição, com o texto que o usuário precisa para decidir.
 *
 * O efeito descrito é o que o domínio garante — nada além. "Suspender" não
 * promete pausar a agenda nem avisar ninguém, porque o contrato não diz isso.
 */
export const PLAN_TRANSITION_PROMPTS: Readonly<
  Record<
    string,
    { label: string; title: string; body: string; destructive?: boolean }
  >
> = {
  ACTIVE: {
    label: "Ativar",
    title: "Ativar PMOC",
    body: "O plano passa a valer: a primeira execução é aberta e a periodicidade começa a contar.",
  },
  SUSPENDED: {
    label: "Suspender",
    title: "Suspender PMOC",
    body: "Novas execuções deixam de ser abertas, e as já abertas ficam indisponíveis enquanto o plano estiver suspenso. O histórico permanece.",
  },
  CANCELLED: {
    label: "Cancelar plano",
    title: "Cancelar PMOC",
    body: "O encerramento é definitivo — o plano não volta a valer. As execuções já cumpridas e os documentos emitidos permanecem no histórico.",
    destructive: true,
  },
};

export function PmocPlanActions({ plan }: { plan: PmocPlan }) {
  const session = useSession();
  const canManage = session.hasPermission("pmoc.manage");

  const activate = useActivatePmocPlan(plan.id);
  const suspend = useSuspendPmocPlan(plan.id);
  const cancel = useCancelPmocPlan(plan.id);

  const document = usePmocPlanDocument(plan.id);

  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  /** Só o que o servidor publicou como transição possível agora. */
  const transitions = canManage
    ? plan.allowedTransitions.filter(
        (status) => status in PLAN_TRANSITION_PROMPTS,
      )
    : [];

  const mutationFor = (status: string) =>
    status === "ACTIVE" ? activate : status === "SUSPENDED" ? suspend : cancel;

  const current = pending ? PLAN_TRANSITION_PROMPTS[pending] : null;
  const mutation = pending ? mutationFor(pending) : null;

  return (
    <>
      <div className="flex items-center gap-2">
        {/* O contrato impresso: partes, vigência, periodicidade, equipamentos
            cobertos e o roteiro de cada unidade. Não é o relatório de execução —
            esse nasce de uma manutenção feita, um por equipamento atendido. */}
        <Button
          variant="outline"
          size="sm"
          disabled={document.isPending}
          onClick={() => document.mutate(undefined)}
        >
          {document.isPending ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <FileDown className="size-3.5" />
          )}
          Baixar contrato
        </Button>

        {canManage ? (
          <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" />
            Editar
          </Button>
        ) : null}

        {transitions.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Ações do plano ${plan.code}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {transitions.map((status) => (
                <DropdownMenuItem
                  key={status}
                  onSelect={() => setPending(status)}
                  className={
                    PLAN_TRANSITION_PROMPTS[status]?.destructive
                      ? "text-destructive focus:text-destructive"
                      : undefined
                  }
                >
                  {PLAN_TRANSITION_PROMPTS[status]?.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {/* A falha do download precisa aparecer: sem isto, um 403 de plano de outra
          unidade ou uma queda do gerador de PDF deixariam o botão piscar e nada
          acontecer — e a pessoa clicaria de novo achando que não apertou. */}
      <MutationError error={document.error} />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={current?.title ?? ""}
        body={current?.body}
        confirmLabel={current?.label ?? "Confirmar"}
        isPending={mutation?.isPending ?? false}
        error={mutation?.error ?? null}
        onConfirm={() => {
          mutation?.mutate(undefined, { onSuccess: () => setPending(null) });
        }}
      />

      <PmocPlanEditDialog
        plan={plan}
        open={editing}
        onOpenChange={setEditing}
      />
    </>
  );
}
