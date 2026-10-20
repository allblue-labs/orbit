"use client";

/**
 * Configurações de documentos.
 *
 * ## O que saiu daqui
 *
 * Um painel "Armazenamento" que dizia, em dois parágrafos, que o local dos
 * arquivos é definido na instalação e não pela organização. Verdade, e resposta
 * para uma pergunta que ninguém faz nas configurações da própria empresa — quem
 * instala o Orbit não procura isso aqui.
 *
 * ## Não altera o Document Engine
 *
 * A PR-19 (Storage & Manifest) e a PR-20 (Rendering Engine) definiram quem
 * decide o quê: o manifest versiona, o renderizador produz, o Storage guarda.
 * Esta aba **lê** o que eles publicam e leva ao lugar onde cada coisa é
 * administrada — não muda comportamento de nenhum dos três.
 *
 * ## Renderizadores vêm do backend
 *
 * `GET /artifact-rendering/metrics` publica os renderizadores disponíveis e
 * qual é o padrão. A lista é do servidor; o Document Registry só acrescenta
 * apresentação.
 *
 * ## O que saiu da tela
 *
 * O identificador cru (`pdf.premium`, em monoespaçada) e o selo do formato.
 * Nenhum dos dois respondia a uma pergunta de quem configura: o id é o que o
 * `POST /render` recebe, e o formato já está dito na descrição. O que faltava
 * era qual deles a plataforma usa quando ninguém escolhe — e isso o backend
 * publica em `defaultRenderer`.
 */
import Link from "next/link";
import { ArrowRight, FileStack, PenLine } from "lucide-react";

import { PanelError, PanelFrame, PanelLoading } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { resolveRenderer } from "@/documents";
import { useAvailableRenderers } from "@/hooks/documents/use-documents";
import { ROUTES } from "@/lib/routes";

export function DocumentsSettingsTab() {
  const metrics = useAvailableRenderers();

  return (
    <div className="max-w-3xl space-y-6">
      <PanelFrame
        panelId="settings-documents-renderers"
        title="Como os documentos saem"
        description="O acabamento que a plataforma aplica ao emitir"
      >
        {metrics.isPending ? (
          <PanelLoading rows={2} />
        ) : metrics.error ? (
          <PanelError
            error={metrics.error}
            onRetry={() => void metrics.refetch()}
          />
        ) : (
          <div className="space-y-3">
            <ul className="space-y-2">
              {metrics.renderers.map((id) => {
                const renderer = resolveRenderer(id);
                /*
                 * O padrão vem de `defaultRenderer`, publicado pelo backend
                 * junto da lista. A ordem de `renderers` é a de registro dos
                 * providers no Nest — marcar o primeiro item como padrão daria
                 * uma tela certa até alguém reordenar o módulo.
                 */
                const padrao = id === metrics.defaultRenderer;
                return (
                  <li
                    key={id}
                    className="flex items-start gap-3 rounded-lg border border-border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {renderer.label}
                        {padrao ? (
                          <Badge variant="secondary">padrão</Badge>
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {renderer.description}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>

            <p className="text-xs text-muted-foreground">
              O acabamento é escolhido ao emitir cada documento. Não há política
              geral da organização: um mesmo modelo pode sair em PDF hoje e como
              página amanhã.
            </p>
          </div>
        )}
      </PanelFrame>

      <PanelFrame
        panelId="settings-documents-policies"
        title="Regras da emissão"
        description="Valem para todos os documentos e não se configuram"
      >
        <div className="space-y-3">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>
              <strong className="text-foreground">Rascunho não emite.</strong>{" "}
              Uma execução em andamento, pausada ou em rascunho pode ser
              pré-visualizada quantas vezes quiser — o rascunho sai igual ao
              documento final —, mas só emite depois de enviada para revisão.
            </li>
            <li>
              <strong className="text-foreground">
                Emitir de novo não sobrescreve.
              </strong>{" "}
              Cada emissão abre uma revisão nova e aposenta a anterior, que
              continua guardada. Uma só fica valendo por vez.
            </li>
            <li>
              <strong className="text-foreground">
                Nada é apagado automaticamente.
              </strong>{" "}
              Um documento cancelado sai de circulação e continua registrado,
              com quem cancelou e quando. Não há prazo de descarte.
            </li>
            <li>
              <strong className="text-foreground">
                O link é temporário e pessoal.
              </strong>{" "}
              O arquivo nunca fica num endereço fixo: cada download gera um link
              que expira em poucos minutos. Expirou, gera outro.
            </li>
            <li>
              <strong className="text-foreground">
                Assinatura é do modelo, não da organização.
              </strong>{" "}
              Cada modelo declara de quem precisa de assinatura, e ela é
              coletada em campo, com a localização de quem assinou.
            </li>
          </ul>
        </div>
      </PanelFrame>

      <PanelFrame
        panelId="settings-documents-shortcuts"
        title="Onde cada coisa se administra"
        description="Configuração vive junto do que ela configura"
      >
        <ul className="space-y-2">
          {[
            {
              label: "Modelos de documento",
              hint: "Estrutura, campos, versões e publicação",
              href: ROUTES.artifacts,
              icon: PenLine,
            },
            {
              label: "Documentos emitidos",
              hint: "Revisões, conteúdo e situação da emissão",
              href: ROUTES.documents,
              icon: FileStack,
            },
          ].map((item) => (
            <li key={item.href}>
              <Button
                variant="ghost"
                className="h-auto w-full justify-between px-3 py-2"
                asChild
              >
                <Link href={item.href}>
                  <span className="flex min-w-0 items-center gap-2 text-left">
                    <item.icon
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {item.hint}
                      </span>
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
