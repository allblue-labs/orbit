"use client";

/**
 * Segurança da plataforma.
 *
 * ## Sessão é pessoal, e o contrato deixa isso claro
 *
 * `GET /identity/me/sessions` lista os dispositivos de **quem consulta**. Não
 * há rota que liste as sessões da organização, e não é um descuido: expor os
 * dispositivos de todo mundo a quem administra a conta é uma decisão de
 * privacidade que o backend não tomou.
 *
 * Esta aba mostra o que **é** da organização — o que o servidor decide sobre
 * autenticação — e leva ao Perfil para o que é pessoal.
 *
 * ## Nada de autenticação aqui
 *
 * Nenhuma política é aplicada nesta tela. Expiração de token, tentativas antes
 * do bloqueio e exigência de MFA são decididas pelo servidor e não publicadas
 * em contrato nenhum — o que está escrito abaixo é descrição do
 * comportamento observado, não configuração.
 */
import Link from "next/link";
import {
  ArrowRight,
  History,
  KeyRound,
  Lock,
  ShieldAlert,
  Users,
} from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers/session-provider";

export function SecuritySettingsTab() {
  const session = useSession();

  return (
    <div className="max-w-3xl space-y-6">
      <PanelFrame
        panelId="settings-security-sessions"
        title="Sessões e dispositivos"
        description="Onde cada coisa é administrada"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            O contrato de sessões é <strong>pessoal</strong>:
            <span className="font-mono"> /identity/me/sessions</span> lista os
            dispositivos de quem consulta. Não há rota que liste as sessões da
            organização.
          </p>
          <p className="text-xs text-muted-foreground">
            Não é descuido: expor os dispositivos de todo mundo a quem
            administra a conta seria uma quebra de privacidade. Para tirar
            alguém de circulação, altere a situação do membro em Equipe.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={ROUTES.profile}>
                <KeyRound className="size-4" />
                Minhas sessões
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href={ROUTES.team}>
                <Users className="size-4" />
                Situação dos membros
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </PanelFrame>

      <PanelFrame
        panelId="settings-security-policies"
        title="Políticas de autenticação"
        description="Regras aplicadas ao acesso"
      >
        <div className="space-y-3">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <Lock
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>
                <strong className="text-foreground">Senha</strong> — mínimo de
                12 caracteres, exigido no cadastro, na recuperação e na troca.
                Trocar a senha encerra as demais sessões.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <ShieldAlert
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>
                <strong className="text-foreground">
                  Bloqueio por tentativas
                </strong>{" "}
                — tentativas seguidas de senha errada bloqueiam o acesso
                temporariamente.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <KeyRound
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>
                <strong className="text-foreground">Dois fatores</strong> — está
                disponível e é <strong>opcional por pessoa</strong>. Não há como
                exigi-lo para toda a organização.
              </span>
            </li>
          </ul>

          <p className="text-xs text-muted-foreground">
            Nenhum destes parâmetros é configurável por organização. Esta lista
            descreve o comportamento, não o configura.
          </p>
        </div>
      </PanelFrame>

      <PanelFrame
        panelId="settings-security-audit"
        title="Histórico de alterações"
        description="O que fica registrado, e onde se consulta"
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Toda alteração é registrada com quem fez, quando, e o valor antes e
            depois. O registro é permanente: nada é sobrescrito nem apagado.
          </p>

          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <History
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>
                <strong className="text-foreground">Por registro.</strong> O
                histórico aparece dentro do próprio registro: o plano de PMOC, a
                configuração de RVT e o orçamento têm a linha do tempo dos
                eventos deles.
              </span>
            </li>
            <li className="flex items-start gap-2">
              <KeyRound
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span>
                <strong className="text-foreground">Seus acessos.</strong> Os
                dispositivos com sessão aberta na sua conta ficam no Perfil, e
                de lá você encerra qualquer um.
              </span>
            </li>
          </ul>

          {/*
           * A consulta ampla ainda não existe — e a tela diz isso em vez de
           * montar uma linha do tempo com o que tem à mão.
           *
           * `AuditLog` guarda tudo e tem o índice certo
           * (`entityType, entityId, createdAt`), mas só PMOC e RVT publicam
           * rota de leitura. Uma "auditoria da organização" montada a partir
           * dos `updatedAt` das listas já carregadas diria "cliente
           * atualizado" sem saber o que mudou, e omitiria tudo que não passa
           * por essas listas: parece completa sem ser, que é o pior defeito
           * possível numa tela de auditoria.
           */}
          <p className="text-xs text-muted-foreground">
            Uma busca por toda a organização — filtrando por pessoa, período ou
            tipo de registro — ainda não está disponível.
          </p>
        </div>
      </PanelFrame>

      <PanelFrame
        panelId="settings-security-context"
        title="Autorização em vigor"
        description="O que o seu acesso permite hoje"
      >
        <div className="space-y-3">
          {/*
           * Havia aqui "12 capabilities · 43 permissões". Dois números que
           * ninguém usa para nada: não dizem o que se pode fazer, e o que dá
           * para deduzir deles está errado — ter mais permissões não é ter
           * mais acesso.
           */}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Plano</span>
            <Badge variant="outline">
              {session.entitlements?.planKey ?? "—"}
            </Badge>
          </div>

          <p className="text-sm text-muted-foreground">
            Cada operação passa por dois crivos: o que o seu{" "}
            <strong>papel</strong> autoriza e o que o seu <strong>plano</strong>{" "}
            inclui. É por isso que um recurso pode faltar mesmo para quem
            administra a conta — e é aí que a resposta muda de lugar: papel se
            resolve em Equipe, plano se resolve na assinatura.
          </p>

          <Button variant="ghost" size="sm" asChild>
            <Link href={ROUTES.profile}>
              Ver o que a minha conta alcança
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </PanelFrame>
    </div>
  );
}
