"use client";

/**
 * Configurações operacionais.
 *
 * ## O único parâmetro real
 *
 * `Organization.settings` é `Json?` **livre** — não há esquema, nem validação,
 * nem catálogo de parâmetros no backend. A autorização de operações atribuídas
 * (PR-12) grava em `settings.operations.requireAssignmentAuthorization`, e é a
 * única chave que a plataforma de fato lê.
 *
 * ## O que a tela não faz
 *
 * Não inventa outros parâmetros. Um interruptor de "comportamento das
 * execuções" ou "política padrão do catálogo" gravaria uma chave que nenhum
 * módulo consulta — configuração que não configura nada é pior que ausência,
 * porque quem a liga acredita ter mudado algo.
 *
 * Havia aqui um painel inteiro dizendo isso: "Outros parâmetros operacionais",
 * com três parágrafos sobre `Organization.settings` não ter esquema. Explicar
 * ao usuário por que uma seção está vazia é uma seção vazia com texto. A
 * decisão é de projeto, e o lugar dela é este comentário.
 */
import { OperationAuthorizationSection } from "@/components/operations/authorization.section";
import { PanelFrame } from "@/components/panels";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ROUTES } from "@/lib/routes";

export function OperationsSettingsTab() {
  return (
    <div className="max-w-3xl space-y-6">
      <OperationAuthorizationSection />

      <PanelFrame
        panelId="settings-operations-shortcuts"
        title="Onde cada coisa se administra"
        description="Configuração vive junto do que ela configura"
      >
        <ul className="space-y-2">
          {[
            {
              label: "Modelos de documento",
              hint: "Estrutura, versões e publicação",
              href: ROUTES.artifacts,
            },
            {
              label: "Catálogo",
              hint: "Produtos, serviços, categorias e preços",
              href: ROUTES.catalog,
            },
            {
              label: "Equipe",
              hint: "Papéis, permissões, escalas e especialidades",
              href: ROUTES.team,
            },
          ].map((item) => (
            <li key={item.href}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between px-3 py-2"
                asChild
              >
                <Link href={item.href}>
                  <span className="min-w-0 text-left">
                    <span className="block text-sm font-medium">
                      {item.label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {item.hint}
                    </span>
                  </span>
                  <ArrowRight className="size-4 shrink-0" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </PanelFrame>
    </div>
  );
}
