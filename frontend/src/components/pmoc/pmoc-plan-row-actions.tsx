"use client";

/**
 * As ações de um plano, na linha da listagem.
 *
 * ## O que faltava
 *
 * A listagem não tinha ação nenhuma: para abrir, editar ou cancelar um PMOC era
 * preciso adivinhar que o nome do plano era um link. Cancelar, em particular, só
 * existia no detalhe — e é a ação que alguém procura justamente olhando a lista.
 *
 * ## O lifecycle continua sendo do servidor
 *
 * `allowedTransitions` passou a ser publicado no resumo, e é ele que decide quais
 * itens existem. Deduzir `status === "DRAFT" → pode ativar` reconstruiria no
 * navegador a máquina de estados que o domínio resolve, e as duas divergiriam na
 * primeira mudança — é a mesma doutrina de `PmocPlanActions`, e os dois leem o mesmo
 * mapa de textos.
 *
 * ## Editar busca o detalhe
 *
 * O formulário de edição precisa de `notes`, que o resumo não traz — e não deve
 * trazer: é texto longo, e a listagem pede cinquenta planos por página. Então o
 * clique busca o plano e abre o diálogo quando ele chega. Uma requisição por edição,
 * contra texto longo em cinquenta linhas que ninguém vai ler.
 */
import { useState } from "react";
import {
  Loader2,
  MoreHorizontal,
  Pencil,
  PenLine,
  ShieldCheck,
  SquareArrowOutUpRight,
} from "lucide-react";
import Link from "next/link";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useActivatePmocPlan,
  useCancelPmocPlan,
  useCreatePmocSignatureLink,
  usePmocPlan,
  useSuspendPmocPlan,
} from "@/hooks/pmoc/use-pmoc";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";
import type { PmocPlanSummary } from "@/types/pmoc";
import { PLAN_TRANSITION_PROMPTS } from "./pmoc-plan-actions";
import { PmocPlanEditDialog } from "./pmoc-plan-edit.dialog";
import { PmocSignatureLinkDialog } from "./pmoc-signature-link.dialog";

export function PmocPlanRowActions({ plan }: { plan: PmocPlanSummary }) {
  const session = useSession();
  const canManage = session.hasPermission("pmoc.manage");

  const activate = useActivatePmocPlan(plan.id);
  const suspend = useSuspendPmocPlan(plan.id);
  const cancel = useCancelPmocPlan(plan.id);
  const signatureLink = useCreatePmocSignatureLink();

  /** Qual transição está esperando confirmação. Nenhuma ação dispara sem passar aqui. */
  const [pending, setPending] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  /**
   * O detalhe só é buscado depois do clique em Editar.
   *
   * `enabled` pela flag, e não pelo id: montar a consulta sempre faria a listagem
   * pedir cinquenta detalhes para abrir uma edição.
   */
  const detalhe = usePmocPlan(editing ? plan.id : "");

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
      <div className="flex items-center justify-end gap-1">
        {/* Abrir é link, e não item de menu: é a ação mais usada da linha, e link
            abre em outra aba com o meio do mouse — um `onClick` não. */}
        <Button variant="ghost" size="icon" asChild>
          <Link
            href={`${ROUTES.pmoc}/${plan.id}`}
            aria-label={`Abrir o plano ${plan.code}`}
          >
            <SquareArrowOutUpRight className="size-4" />
          </Link>
        </Button>

        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Ações do plano ${plan.code}`}
              >
                {detalhe.isLoading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="size-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil className="size-3.5" />
                Editar
              </DropdownMenuItem>

              {/*
                Enviar para assinatura não pede confirmação, mas **avisa**: a ação
                não é destrutiva no plano, e sim no link anterior — gerar um novo
                revoga o que já circulou. O aviso vive no diálogo, junto do link
                novo, porque é ali que ele é acionável; uma confirmação antes
                perguntaria sobre um link que o dono talvez nunca tenha gerado.

                Sem cobertura não há contrato a assinar: o backend recusa com 409, e
                oferecer o item seria oferecer um erro.
              */}
              {plan.coveredEquipment > 0 ? (
                <DropdownMenuItem
                  onSelect={() => signatureLink.mutate(plan.id)}
                  disabled={signatureLink.isPending}
                >
                  <PenLine className="size-3.5" />
                  Enviar para assinatura
                </DropdownMenuItem>
              ) : null}

              {transitions.length > 0 ? <DropdownMenuSeparator /> : null}

              {transitions.map((status) => (
                <DropdownMenuItem
                  key={status}
                  /*
                    Nunca executa no clique: abre a confirmação.
                    Ativar começa a contar a periodicidade e cancelar é definitivo —
                    nenhum dos dois é desfazível por um segundo clique.
                  */
                  onSelect={() => setPending(status)}
                  className={
                    PLAN_TRANSITION_PROMPTS[status]?.destructive
                      ? "text-destructive focus:text-destructive"
                      : undefined
                  }
                >
                  <ShieldCheck className="size-3.5" />
                  {PLAN_TRANSITION_PROMPTS[status]?.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

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

      {/* O diálogo só monta com o plano em mãos: montar antes abriria um formulário
          com os campos em branco e o nome do plano faltando. */}
      {editing && detalhe.data ? (
        <PmocPlanEditDialog
          plan={detalhe.data}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(false);
          }}
        />
      ) : null}

      <PmocSignatureLinkDialog
        resultado={signatureLink.data ?? null}
        error={signatureLink.error}
        isPending={signatureLink.isPending}
        /* `reset` e não uma flag de aberto: é o que descarta o token da memória do
           React Query ao fechar. Mantê-lo em `data` deixaria a credencial do
           contrato viva pelo resto da navegação. */
        onOpenChange={() => signatureLink.reset()}
      />

      {/* A falha ao buscar o detalhe não pode ser silenciosa: sem isto, clicar em
          Editar e nada acontecer é indistinguível de um clique que não pegou. */}
      {editing && detalhe.error ? (
        <MutationError error={detalhe.error} />
      ) : null}
    </>
  );
}
