"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { loginFailure } from "@/lib/login-failure";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SessionLoading } from "@/guards";
import { useLogin } from "@/hooks/api";
import { LOGIN_REASON_PARAM, LoginReason, ROUTES } from "@/lib/routes";

const REASON_MESSAGES: Record<string, { title: string; description: string }> =
  {
    [LoginReason.expired]: {
      title: "Sessão encerrada",
      description:
        "Sua sessão expirou por inatividade. Entre novamente para continuar.",
    },
    [LoginReason.unauthorized]: {
      title: "Acesso não autorizado",
      description: "Entre com uma conta que tenha acesso a esta área.",
    },
  };

/**
 * `useSearchParams` exige um limite de Suspense — a leitura dos parâmetros só
 * acontece no cliente.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={<SessionLoading label="Carregando…" />}>
      <LoginView />
    </Suspense>
  );
}

function LoginView() {
  const [showPassword, setShowPassword] = useState(false);
  const [requiresMfa, setRequiresMfa] = useState(false);
  const params = useSearchParams();
  const reason = REASON_MESSAGES[params.get(LOGIN_REASON_PARAM) ?? ""];
  const destination = params.get("destino") ?? undefined;
  const login = useLogin({ redirectTo: destination });
  const loading = login.isPending;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await login.mutateAsync({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        mfaCode: String(form.get("mfaCode") ?? "") || undefined,
        client: "WEB",
      });
    } catch (error) {
      /* A decisão é pelo código publicado do erro, e vive em `login-failure`
         para poder ser testada sem DOM. Ver o comentário de lá: comparar a
         mensagem interna trancava fora quem ativava o segundo fator. */
      const acao = loginFailure(error);
      if (acao.revealMfa) setRequiresMfa(true);
      toast.error(acao.title, { description: acao.description });
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      {/* Form side */}
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Orbit — início">
            <OrbitLogo />
          </Link>
          <Button asChild variant="ghost" size="sm">
            <Link href="/">Voltar ao site</Link>
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
              Bem-vindo de volta
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Entre com suas credenciais para acessar o workspace da sua
              operação.
            </p>

            {reason ? (
              <Alert className="mt-6">
                <AlertTitle>{reason.title}</AlertTitle>
                <AlertDescription>{reason.description}</AlertDescription>
              </Alert>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-8 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-mail corporativo</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    placeholder="voce@empresa.com"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Senha</Label>
                  <Link
                    href={ROUTES.forgotPassword}
                    prefetch={false}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Esqueceu a senha?
                  </Link>
                </div>
                <div className="relative">
                  <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    placeholder="••••••••"
                    className="px-9"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
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
              </div>

              <div className="flex items-center gap-2">
                <Checkbox id="remember" defaultChecked />
                <Label
                  htmlFor="remember"
                  className="text-sm font-normal text-muted-foreground"
                >
                  Manter-me conectado
                </Label>
              </div>

              {requiresMfa && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="space-y-2"
                >
                  <Label htmlFor="mfaCode">Código de segurança</Label>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="mfaCode"
                      name="mfaCode"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      minLength={6}
                      maxLength={10}
                      required
                      placeholder="000000"
                      className="pl-9 font-mono tracking-[0.25em]"
                    />
                  </div>
                </motion.div>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="size-4" />
                  </>
                )}
              </Button>
            </form>

            <div className="my-6 flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-[11px] tracking-wider text-muted-foreground uppercase">
                ou
              </span>
              <Separator className="flex-1" />
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={() => toast.info("SSO corporativo em breve")}
            >
              <ShieldCheck className="size-4" />
              Entrar com SSO corporativo
            </Button>

            <p className="mt-8 text-center text-sm text-muted-foreground">
              Ainda não tem acesso?{" "}
              <Link
                href="/cadastro"
                prefetch={false}
                className="font-medium text-primary hover:underline"
              >
                Criar minha organização
              </Link>
            </p>
          </motion.div>
        </div>

        <p className="text-center text-xs text-muted-foreground">
          Ao continuar você concorda com os Termos de Uso e a Política de
          Privacidade.
        </p>
      </div>

      {/* Brand side */}
      <aside className="bg-gradient-orbit relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden
          className="absolute -top-24 -right-24 size-96 rounded-full border border-primary-foreground/20"
        />
        <div
          aria-hidden
          className="absolute -bottom-40 -left-24 size-[28rem] rounded-full border border-primary-foreground/15"
        />

        <p className="relative text-sm font-medium tracking-[0.2em] text-primary-foreground/70 uppercase">
          Orbit Operations ERP
        </p>

        {/*
          O que o produto faz, e não um depoimento.

          Aqui havia uma citação de "Marina Duarte, Diretora de Operações da
          Acme Industries" — nome de fixture de teste — creditando ao Orbit uma
          redução de 38% no retrabalho, ao lado de "12k+ ordens/mês" e "99,9%
          de uptime". Nenhum dos quatro tem origem: não existe essa pessoa, não
          existe esse cliente, não há medição e não há SLA publicado. Atribuir
          uma frase a alguém que não a disse é o tipo de coisa que se explica
          mal depois, e número inventado numa tela de login é promessa que a
          operação vai cobrar.

          O que ficou é verificável lendo o produto: os três módulos existem, o
          aplicativo funciona offline, e o documento sai da execução.
        */}
        <div className="relative max-w-md">
          <p className="font-display text-3xl leading-snug font-semibold text-primary-foreground">
            A operação inteira gira em torno de um cadastro só.
          </p>
          <p className="mt-6 text-sm leading-relaxed text-primary-foreground/80">
            Ordem de serviço, PMOC e visita técnica dividem o mesmo cliente, o
            mesmo parque de equipamentos e a mesma equipe. O que o técnico
            preenche em campo é o que sai no documento — sem planilha no meio.
          </p>
        </div>

        <div className="relative grid grid-cols-3 gap-4">
          {[
            { t: "OS · PMOC · RVT", d: "no mesmo cadastro" },
            { t: "Campo offline", d: "sincroniza ao voltar" },
            { t: "Documento", d: "emitido da execução" },
          ].map((item) => (
            <div
              key={item.t}
              className="rounded-xl bg-primary-foreground/10 p-4 backdrop-blur-sm"
            >
              <p className="font-display text-sm font-bold text-primary-foreground">
                {item.t}
              </p>
              <p className="mt-0.5 text-xs text-primary-foreground/75">
                {item.d}
              </p>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
