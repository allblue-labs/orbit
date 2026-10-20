"use client";

/**
 * O caminho para o plano.
 *
 * Não é uma segunda tela de plano — é uma porta. A aba **Plano e assinatura**
 * é a superfície canônica: ela tem o catálogo, o preço, a periodicidade, o
 * consumo do período e as ações que o servidor autoriza. Repetir aqui um
 * pedaço disso foi o que produziu duas respostas para a mesma pergunta.
 */
import { ArrowRight, CircleDollarSign } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Button } from "@/components/ui/button";
import { SECTION_PARAM } from "@/lib/section-navigation";
import { ROUTES } from "@/lib/routes";

export function SubscriptionPointer() {
  return (
    <PanelFrame
      panelId="organization-subscription-pointer"
      title="Plano e assinatura"
      description="Catálogo, periodicidade, consumo do período e contratação"
    >
      <div className="flex items-start gap-3">
        <CircleDollarSign
          className="mt-0.5 size-5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            O plano contratado, os limites, o consumo do período corrente e a
            troca de plano ficam numa aba só.
          </p>
          <Button asChild variant="outline" size="sm">
            <a href={`${ROUTES.settings}?${SECTION_PARAM}=assinatura`}>
              Abrir Plano e assinatura
              <ArrowRight className="size-4" />
            </a>
          </Button>
        </div>
      </div>
    </PanelFrame>
  );
}
