"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, MailCheck, Send } from "lucide-react";
import { apiClient } from "@/api/client";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Confirmation requires an explicit action; mail scanners cannot consume a GET link. */
function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
function fragmentToken() {
  const value =
    new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
  return /^[A-Za-z0-9_-]{64}$/.test(value) ? value : "";
}

export function ConfirmEmail() {
  const token = useSyncExternalStore(subscribeToHash, fragmentToken, () => "");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post<void>(
        "/identity/email/verify",
        { token },
        { retries: 0 },
      );
      setConfirmed(true);
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      setError(
        "Não foi possível confirmar seu e-mail. O link pode ter expirado ou já ter sido utilizado. Você pode tentar novamente ou solicitar outro abaixo.",
      );
    } finally {
      setBusy(false);
    }
  };
  const resend = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiClient.post<void>(
        "/identity/email/resend",
        { email: email.trim() },
        { retries: 0 },
      );
      setSent(true);
    } catch {
      setError(
        "Não foi possível enviar a solicitação agora. Aguarde um momento e tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-dvh flex-col bg-background px-5 py-8 sm:px-10">
      <Link href="/" aria-label="Orbit — início" className="w-fit">
        <OrbitLogo />
      </Link>
      <div className="flex flex-1 items-center justify-center py-10">
        <section
          className="w-full max-w-md space-y-6 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-9"
          aria-labelledby="email-confirmation-title"
        >
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {confirmed ? (
              <CheckCircle2 className="size-7" />
            ) : (
              <MailCheck className="size-7" />
            )}
          </div>
          <div className="space-y-2">
            <h1
              id="email-confirmation-title"
              className="font-display text-2xl font-bold"
            >
              {confirmed ? "E-mail confirmado!" : "Confirme seu e-mail"}
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {confirmed
                ? "Seu endereço de e-mail foi confirmado com sucesso. Sua conta do Orbit está atualizada."
                : "Bem-vindo ao Orbit! Confirme que este endereço pertence a você. O link recebido por e-mail é exclusivo e vale por 24 horas."}
            </p>
          </div>
          {error ? (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}
          {confirmed ? (
            <Button asChild className="w-full">
              <Link href="/login">Continuar para o Orbit</Link>
            </Button>
          ) : (
            <>
              {token ? (
                <Button
                  onClick={() => void confirm()}
                  disabled={busy}
                  className="w-full"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MailCheck className="size-4" />
                  )}
                  Confirmar meu e-mail
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Abra o link recebido ou solicite um novo e-mail abaixo.
                </p>
              )}
              <form
                onSubmit={(event) => void resend(event)}
                className="space-y-3 border-t border-border pt-5"
              >
                <p className="text-sm font-medium">Precisa de um novo link?</p>
                <div className="space-y-2">
                  <Label htmlFor="verification-email">Seu e-mail</Label>
                  <Input
                    id="verification-email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={320}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="voce@empresa.com"
                    disabled={busy || sent}
                  />
                </div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={busy || sent}
                  className="w-full"
                >
                  {busy ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Solicitar novo e-mail
                </Button>
                {sent ? (
                  <p
                    role="status"
                    className="text-sm leading-relaxed text-muted-foreground"
                  >
                    Se houver uma conta aguardando confirmação, enviaremos as
                    instruções. Verifique também a pasta de spam e aguarde pelo
                    menos um minuto antes de pedir outro link.
                  </p>
                ) : null}
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
