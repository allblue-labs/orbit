"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  LifeBuoy,
  Loader2,
  Mail,
  MessageSquare,
  Send,
} from "lucide-react";
import { apiClient } from "@/api/client";
import { ApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ContactSection() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const input = {
      name: String(data.get("name") ?? "").trim(),
      email: String(data.get("email") ?? "").trim(),
      topic: String(data.get("topic") ?? "SUPPORT"),
      message: String(data.get("message") ?? "").trim(),
      website: String(data.get("website") ?? ""),
    };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
      setError("Informe um endereço de e-mail válido.");
      return;
    }
    if (input.name.length < 2 || input.message.length < 10) {
      setError(
        "Informe seu nome e escreva uma mensagem com pelo menos 10 caracteres.",
      );
      return;
    }
    const payload = JSON.stringify(input);
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    setPending(true);
    setError("");
    try {
      await apiClient.post("/public/contact", input, {
        retries: 0,
        headers: { "idempotency-key": attempt.current.key },
      });
      setSent(true);
      attempt.current = null;
    } catch (reason) {
      setError(
        reason instanceof ApiError && reason.status === 429
          ? "Você enviou várias mensagens recentemente. Aguarde antes de tentar novamente."
          : reason instanceof Error
            ? reason.message
            : "Não foi possível enviar agora. Tente novamente em instantes.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      id="contato"
      aria-labelledby="contact-title"
      className="scroll-mt-20 border-t border-border bg-muted/20"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <div className="max-w-md">
          <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary">
            <MessageSquare className="size-4" aria-hidden="true" />
            Vamos conversar
          </span>
          <h2
            id="contact-title"
            className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl"
          >
            Seu próximo passo começa com uma conversa.
          </h2>
          <p className="mt-4 leading-relaxed text-muted-foreground">
            Precisa de ajuda com o Orbit, tem uma dúvida ou quer sugerir uma
            melhoria? Envie sua mensagem para o nosso time.
          </p>
          <div className="mt-8 space-y-5">
            <div className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <LifeBuoy className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-medium">Suporte para a sua operação</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Conte o que aconteceu e como podemos ajudar.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Mail className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-medium">A resposta chega ao seu e-mail</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Usaremos o endereço informado para conversar sobre esta
                  solicitação.
                </p>
              </div>
            </div>
          </div>
        </div>
        <div className="rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8">
          {sent ? (
            <div
              role="status"
              className="flex min-h-80 flex-col items-center justify-center text-center"
            >
              <span className="mb-5 flex size-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-8" aria-hidden="true" />
              </span>
              <h3 className="font-display text-2xl font-semibold">
                Mensagem recebida
              </h3>
              <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                Sua mensagem será encaminhada para o time do Orbit. A resposta
                chegará ao e-mail informado.
              </p>
              <Button
                variant="outline"
                className="mt-6"
                onClick={() => {
                  setSent(false);
                  setError("");
                }}
              >
                Enviar outra mensagem
              </Button>
            </div>
          ) : (
            <form
              method="post"
              noValidate
              onSubmit={submit}
              aria-label="Feedback e suporte"
              aria-busy={pending}
              className="space-y-5"
            >
              <div>
                <h3 className="text-xl font-semibold">
                  Fale com o time do Orbit
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Os campos marcados com * são obrigatórios.
                </p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contact-name">Nome *</Label>
                  <Input
                    id="contact-name"
                    name="name"
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={120}
                    disabled={pending}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contact-email">E-mail *</Label>
                  <Input
                    id="contact-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    disabled={pending}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-topic">Assunto *</Label>
                <select
                  id="contact-topic"
                  name="topic"
                  defaultValue="SUPPORT"
                  required
                  disabled={pending}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  <option value="SUPPORT">Preciso de suporte</option>
                  <option value="FEEDBACK">Feedback ou sugestão</option>
                  <option value="QUESTION">Dúvida sobre o Orbit</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact-message">Mensagem *</Label>
                <Textarea
                  id="contact-message"
                  name="message"
                  required
                  minLength={10}
                  maxLength={5000}
                  rows={5}
                  placeholder="Como podemos ajudar?"
                  disabled={pending}
                />
              </div>
              <div
                aria-hidden="true"
                className="absolute -left-[10000px] top-auto size-px overflow-hidden"
              >
                <label htmlFor="contact-website">Website</label>
                <input
                  id="contact-website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  disabled={pending}
                />
              </div>
              {error ? (
                <Alert variant="destructive" role="alert">
                  <AlertTitle>Não foi possível enviar</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}
              <p className="text-xs leading-relaxed text-muted-foreground">
                Os dados serão usados para atender sua mensagem, conforme nossa{" "}
                <Link
                  href="/legal/privacidade"
                  className="underline underline-offset-2"
                >
                  Política de Privacidade
                </Link>
                .
              </p>
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={pending}
              >
                {pending ? (
                  <>
                    <Loader2
                      className="size-4 animate-spin"
                      aria-hidden="true"
                    />
                    Enviando mensagem…
                  </>
                ) : (
                  <>
                    <Send className="size-4" aria-hidden="true" />
                    Enviar mensagem
                  </>
                )}
              </Button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
