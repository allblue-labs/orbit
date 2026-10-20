"use client";

/**
 * Fronteira de erro de uma aba.
 *
 * `PanelErrorBoundary` exige `panelId` e `fallback`. Repetir o mesmo fallback
 * em cada aba de cada Workspace seria a mesma cópia de sempre — aqui ele tem
 * um lugar.
 *
 * ## O que ela cobre, e o que não
 *
 * Só erros de **renderização**: contrato divergente, campo ausente, exceção em
 * biblioteca de gráfico. Falha de rede é estado do TanStack Query e aparece
 * dentro do próprio painel, com "tentar de novo".
 *
 * A aba que quebra não derruba as outras. É o que permite ler as operações de
 * um cliente mesmo quando a aba de documentos encontra um formato que não sabe
 * desenhar.
 *
 * ## A mensagem diz o que falhou
 *
 * O fallback recebia o erro e o **descartava**: a tela dizia "não foi possível
 * exibir as certificações" e mais nada. Custou uma investigação inteira — o
 * relato não tinha como incluir a informação que já existia
 * (`find is not a function`, de um contrato que o tipo descrevia errado), e a
 * mensagem mandava recarregar, o que nunca resolve erro de renderização.
 *
 * Agora a frase técnica aparece ao lado, em fonte de código. Não é bonito, e é
 * exatamente o que alguém precisa copiar para um relato.
 */
import type { ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { PanelErrorBoundary } from "@/components/panels";

export function TabBoundary({
  id,
  label,
  children,
}: {
  /** Identificador da aba, usado no log de desenvolvimento. */
  id: string;
  /** Nome da aba, dito ao usuário quando ela falha. */
  label: string;
  children: ReactNode;
}) {
  return (
    <PanelErrorBoundary
      panelId={id}
      fallback={(error) => (
        <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-center">
          <TriangleAlert className="size-5 text-destructive" aria-hidden />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Não foi possível exibir {label}
            </p>
            <p className="text-sm text-muted-foreground">
              As demais abas continuam disponíveis. Isto é falha de programação,
              não de dados: recarregar não resolve.
            </p>
            {error.message ? (
              <p className="mx-auto max-w-lg pt-1 font-mono text-xs break-words text-muted-foreground">
                {error.message}
              </p>
            ) : null}
          </div>
        </div>
      )}
    >
      {children}
    </PanelErrorBoundary>
  );
}
