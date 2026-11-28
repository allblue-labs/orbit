"use client";

/**
 * Landing do Platform Administrator.
 *
 * O painel de administração é escopo de uma PR posterior. Esta página existe
 * porque o administrador global não pertence a nenhuma organização: mandá-lo
 * para `/dashboard` produziria 403 em todas as chamadas de tenant. Aqui ele
 * tem um destino válido após o login e o caminho de saída da sessão.
 */
import { Building2, ShieldCheck, Users } from "lucide-react";

import { OrbitLogo } from "@/components/brand/orbit-logo";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MfaSection } from "@/components/profile/mfa.section";
import { RequireAuth, RequirePlatformAdmin } from "@/guards";
import { useLogout } from "@/hooks/api";
import { ROUTES } from "@/lib/routes";
import { useSession } from "@/providers";

const CAPABILITIES = [
  {
    icon: Building2,
    title: "Organizações",
    description:
      "Criar organizações com o primeiro responsável, acompanhar assinaturas e ciclo de vida.",
  },
  {
    icon: Users,
    title: "Usuários globais",
    description: "Consultar usuários de todas as organizações e seus vínculos.",
  },
  {
    icon: ShieldCheck,
    title: "Planos e módulos",
    description:
      "Administrar planos, capacidades e módulos disponíveis na plataforma.",
  },
];

export default function PlatformPage() {
  return (
    <RequireAuth requireOrganization={false} anonymousRedirectTo={ROUTES.login}>
      <PlatformAccess />
    </RequireAuth>
  );
}

function PlatformAccess() {
  const { session, user } = useSession();
  const logout = useLogout();
  if (session.authenticated && session.platformMfaRequired) {
    const enabled = user?.mfaEnabled === true;
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 px-6 py-10">
        <OrbitLogo />
        <div className="space-y-2">
          <h1 className="font-display text-2xl font-semibold">
            Proteja o acesso administrativo
          </h1>
          <p className="text-sm text-muted-foreground">
            A administração da plataforma exige autenticação em dois fatores.
            {enabled
              ? " Entre novamente com sua senha e um código de segurança."
              : " Configure seu aplicativo autenticador e depois entre novamente."}
          </p>
        </div>
        <MfaSection enabled={enabled} allowDisable={false} />
        <Button
          variant="outline"
          className="self-start"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          {enabled ? "Sair para entrar com o código" : "Sair"}
        </Button>
      </main>
    );
  }
  return (
    <RequirePlatformAdmin>
      <PlatformLanding />
    </RequirePlatformAdmin>
  );
}

function PlatformLanding() {
  const session = useSession();
  const logout = useLogout();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <OrbitLogo />
        <div className="flex items-center gap-3">
          <Badge variant="secondary">Administração da plataforma</Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
          >
            Sair
          </Button>
        </div>
      </header>

      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
          Olá, {session.user?.displayName ?? session.user?.email}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Sua conta tem acesso global e não pertence a nenhuma organização
          cliente. O painel de administração será entregue em uma próxima etapa;
          a autenticação e o roteamento já estão preparados.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CAPABILITIES.map((capability) => (
          <Card key={capability.title}>
            <CardHeader>
              <span className="flex size-9 items-center justify-center rounded-lg bg-surface-strong text-primary">
                <capability.icon className="size-4" />
              </span>
              <CardTitle className="mt-3 text-base">
                {capability.title}
              </CardTitle>
              <CardDescription>{capability.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">Em breve</Badge>
            </CardContent>
          </Card>
        ))}
      </div>
      <MfaSection enabled={session.user?.mfaEnabled === true} />
      <div className="border-t border-border pt-6">
        <Button asChild variant="outline">
          <Link href="/design-system">Abrir Design System</Link>
        </Button>
      </div>
    </main>
  );
}
