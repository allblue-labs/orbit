"use client";

/**
 * Confirmação de ação destrutiva, com o texto do Action Registry.
 *
 * O registry declara `confirm: { title, body, confirmLabel }` desde a PR-14.5,
 * e valida que toda ação destrutiva o tenha — mas nenhuma tela renderizava
 * esse texto: a exclusão de categoria do catálogo dispara direto no clique.
 * Aqui o texto declarado finalmente aparece.
 *
 * Usa o `AlertDialog` do Design System, que já existe e nunca tinha sido usado.
 * Nada de novo foi desenhado.
 *
 * O erro da mutação fica **dentro** do diálogo: uma recusa do servidor — "a
 * categoria ainda tem lançamentos" — precisa ser lida onde a decisão foi
 * tomada, e não num canto da tela depois de o diálogo fechar.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import type { ReactNode } from "react";

import type { ApiError } from "@/lib/api-error";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  isPending = false,
  error = null,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body?: string;
  confirmLabel: string;
  onConfirm: () => void;
  isPending?: boolean;
  error?: ApiError | null;
  /**
   * O que a decisão ainda precisa coletar, entre o texto e os botões.
   *
   * Opcional e deliberadamente estreito: serve a confirmações que pedem **um**
   * dado — uma resposta, um motivo —, e não a um formulário. Confirmação que
   * precise de formulário não é confirmação, é outro diálogo.
   */
  children?: ReactNode;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {body ? (
            <AlertDialogDescription>{body}</AlertDialogDescription>
          ) : null}
        </AlertDialogHeader>

        {children ? <div className="space-y-2">{children}</div> : null}

        <MutationError error={error} />

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Voltar</AlertDialogCancel>
          {/*
            `onSelect` com `preventDefault` mantém o diálogo aberto enquanto a
            requisição corre — fechar antes da resposta esconderia a recusa.
          */}
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
            disabled={isPending}
          >
            {isPending ? "Aguarde…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
