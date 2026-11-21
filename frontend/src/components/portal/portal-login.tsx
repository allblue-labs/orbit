"use client";

/**
 * Entrar na área do cliente.
 *
 * O acesso é criado pela empresa que atende o cliente, com senha temporária.
 * Por isso "esqueci a senha" não manda e-mail: o endereço é um login, e quem
 * gera outra senha é a empresa.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2, LogIn } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-error";
import { usePortalLogin, usePortalSignedIn } from "@/portal/portal-hooks";
import { BiometricSignIn } from "@/components/auth/biometric-sign-in";
import { markPasswordLogin } from "@/lib/biometrics/webauthn";

export function PortalLogin() {
  const router = useRouter();
  const login = usePortalLogin();
  const signedIn = usePortalSignedIn();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [esqueci, setEsqueci] = useState(false);

  const entrar = (event: React.FormEvent) => {
    event.preventDefault();
    login.mutate(
      { email, password: senha },
      {
        onSuccess: () => {
          markPasswordLogin("portal");
          router.replace("/portal");
        },
      },
    );
  };

  const credenciaisErradas =
    login.error instanceof ApiError && login.error.status === 401;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <Link
        href="/"
        className="flex items-center gap-2 self-start text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Orbit
      </Link>
      <div className="space-y-6 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-3">
          <OrbitLogo className="h-7 w-auto" />
          <div className="space-y-1">
            <h1 className="text-xl font-semibold">Portal do cliente</h1>
            <p className="text-sm text-muted-foreground">
              Acompanhe seus equipamentos, atendimentos e documentos, e abra
              chamados para a empresa que cuida da sua climatização.
            </p>
          </div>
        </div>
        <form className="space-y-4" onSubmit={entrar}>
          <div className="space-y-1.5">
            <Label htmlFor="portal-email">E-mail de acesso</Label>
            <Input
              id="portal-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="portal-senha">Senha</Label>
            <Input
              id="portal-senha"
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              required
            />
          </div>
          {credenciaisErradas ? (
            <p className="text-sm text-destructive">
              E-mail ou senha incorretos. Confira o acesso que a empresa passou
              para você.
            </p>
          ) : (
            <MutationError error={login.error} />
          )}
          <Button type="submit" className="w-full" disabled={login.isPending}>
            {login.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LogIn className="size-4" />
            )}
            Entrar
          </Button>
          <BiometricSignIn
            audience="portal"
            onSignedIn={(result) => {
              signedIn(result);
              router.replace("/portal");
            }}
          />
        </form>
        <div className="space-y-2 border-t border-border pt-4 text-sm">
          <button
            type="button"
            className="font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setEsqueci((valor) => !valor)}
          >
            Esqueci minha senha
          </button>
          {esqueci ? (
            <p className="text-muted-foreground">
              Peça uma nova senha à empresa que cuida dos seus equipamentos. Ela
              gera uma senha temporária, e você cria a sua no primeiro acesso.
            </p>
          ) : null}
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        É da equipe?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Entre aqui
        </Link>
        {" · "}
        <Link href="/legal/termos" className="hover:underline">
          Termos de Uso
        </Link>
        {" · "}
        <Link href="/legal/privacidade" className="hover:underline">
          Privacidade
        </Link>
      </p>
    </main>
  );
}
