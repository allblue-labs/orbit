"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  ShieldAlert,
  UserRound,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SessionLoading } from "@/guards";
import { useAcceptInvitation } from "@/hooks/api";
import { ROUTES } from "@/lib/routes";
import { passwordPolicyIssues } from "@/lib/password-policy";
import { PasswordRequirements } from "@/components/auth/password-requirements";

export default function InvitationPage() {
  return (
    <Suspense fallback={<SessionLoading label="Carregando convite…" />}>
      <InvitationView />
    </Suspense>
  );
}

/**
 * Aceite de convite (`POST /identity/invitations/accept`).
 *
 * É o terceiro caminho de entrada da plataforma: o usuário não escolhe plano
 * nem cria organização — entra em uma organização existente, com o papel e a
 * unidade definidos por quem convidou.
 */
function InvitationView() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const acceptInvitation = useAcceptInvitation();

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submittedPassword = String(form.get("password") ?? "");
    const issues = passwordPolicyIssues(submittedPassword);
    if (issues.length > 0) {
      toast.error("A senha ainda não atende aos requisitos", {
        description: issues.join("; "),
      });
      return;
    }
    if (submittedPassword !== String(form.get("confirmPassword") ?? "")) {
      toast.error("As senhas não coincidem");
      return;
    }
    try {
      await acceptInvitation.mutateAsync({
        token,
        firstName: String(form.get("firstName") ?? ""),
        lastName: String(form.get("lastName") ?? ""),
        password: submittedPassword,
      });
      toast.success("Convite aceito", {
        description: "Entre com seu e-mail e a senha que você acabou de criar.",
      });
    } catch (error) {
      toast.error("Não foi possível aceitar o convite", {
        description:
          error instanceof Error
            ? error.message
            : "O convite pode ter expirado. Peça um novo para o administrador.",
      });
    }
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 py-8 sm:px-10">
      <div className="flex items-center justify-between">
        <Link href={ROUTES.home} aria-label="Orbit — início">
          <OrbitLogo />
        </Link>
        <Button asChild variant="ghost" size="sm">
          <Link href={ROUTES.login}>Já tenho conta</Link>
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-center py-10">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm"
        >
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground">
            Aceitar convite
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Complete seu cadastro para entrar na organização que convidou você.
          </p>

          {token ? (
            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">Nome</Label>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="firstName"
                      name="firstName"
                      autoComplete="given-name"
                      required
                      className="pl-9"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Sobrenome</Label>
                  <Input
                    id="lastName"
                    name="lastName"
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Senha</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••••••"
                    className="px-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={
                      showPassword ? "Ocultar senha" : "Mostrar senha"
                    }
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </div>
                <PasswordRequirements password={password} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirme a senha</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    placeholder="••••••••••••"
                    className="pl-9"
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={acceptInvitation.isPending}
              >
                {acceptInvitation.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Aceitar e criar acesso
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>
          ) : (
            <div className="mt-8 space-y-6">
              <Alert>
                <ShieldAlert className="size-4" />
                <AlertTitle>Convite não encontrado</AlertTitle>
                <AlertDescription>
                  Abra o link exatamente como recebeu por e-mail. Se ele
                  expirou, peça um novo convite ao administrador da organização.
                </AlertDescription>
              </Alert>
              <Button asChild variant="outline" className="w-full">
                <Link href={ROUTES.login}>Voltar ao login</Link>
              </Button>
            </div>
          )}
        </motion.div>
      </div>
    </main>
  );
}
