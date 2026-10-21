"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Camera,
  PenLine,
  ShieldCheck,
  Sparkles,
  Smartphone,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { PanelError, PanelLoading } from "@/components/panels";
import { useProfile, useDismissWelcome } from "@/hooks/profile/use-profile";
import { initialsOf } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useSession } from "@/providers/session-provider";
import { AvatarSection } from "./avatar.section";
import { SignatureSection } from "./signature.section";
import { MfaSection } from "./mfa.section";
import { MOBILE_APP_INTRO } from "@/components/mobile/orbit-mobile-presentation";
import { WelcomeMobileStep } from "./welcome-mobile.step";

const STEPS = [
  {
    title: "Seu espaço começa aqui",
    label: "Boas-vindas",
    description:
      "Vamos deixar sua conta com a sua cara. São poucos passos e você escolhe o que configurar agora.",
    icon: Sparkles,
  },
  {
    title: "Um rosto para sua conta",
    label: "Foto",
    description:
      "Adicione sua foto para a equipe reconhecer você nas atividades do dia a dia.",
    icon: Camera,
  },
  {
    title: "Sua assinatura, à mão",
    label: "Assinatura",
    description:
      "Prepare a assinatura que você vai usar nos documentos. Você pode desenhar ou enviar uma imagem.",
    icon: PenLine,
  },
  {
    title: "Mais proteção em cada acesso",
    label: "Segurança",
    description:
      "Ative a autenticação em dois fatores para proteger sua conta com um código além da senha.",
    icon: ShieldCheck,
  },
  {
    ...MOBILE_APP_INTRO,
    label: "App mobile",
    icon: Smartphone,
  },
] as const;

/** Automatic once per account. Password changes and subscription notices come first. */
export function WelcomeSetup() {
  const session = useSession();
  if (
    !session.isAuthenticated ||
    session.isPlatformAdmin ||
    !session.organization ||
    !session.subscriptionActive ||
    session.requiresPasswordChange ||
    !session.user ||
    session.user.welcomeDismissedAt
  )
    return null;

  return <WelcomeWizard key={session.user.id} />;
}

/** The same guide stays available after skipping or completing it. */
export function WelcomeSetupButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sparkles className="size-4" aria-hidden />
        Configuração guiada
      </Button>
      {open ? <WelcomeWizard onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function WelcomeWizard({ onClose }: { onClose?: () => void }) {
  const session = useSession();
  const profile = useProfile();
  const update = useDismissWelcome();
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [closed, setClosed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const current = STEPS[step];
  const Icon = current.icon;
  const last = step === STEPS.length - 1;

  const goToStep = (next: number) => {
    bodyRef.current?.scrollTo({ top: 0 });
    setStep(next);
  };

  const dismiss = () => {
    if (update.isPending) return;
    update.mutate(undefined, {
      onSuccess: () => {
        setClosed(true);
        onClose?.();
      },
    });
  };

  return (
    <Dialog
      open={!closed}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent
        className="flex max-h-[92dvh] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:rounded-2xl motion-reduce:animate-none"
        onInteractOutside={(event) => event.preventDefault()}
      >
        <div className="relative shrink-0 overflow-hidden border-b border-border bg-gradient-to-br from-primary/15 via-background to-primary/5 px-6 pb-6 pt-8 sm:px-8">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-24 size-72 rounded-full border border-primary/15"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-4 -top-12 size-48 rounded-full border border-primary/15"
          />
          <OrbitLogo className="relative mb-6 h-7" />
          <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary">
            <Icon className="size-4" aria-hidden />
            {step === 0
              ? "Bem-vindo ao Orbit"
              : `Passo ${step} de ${STEPS.length - 1}`}
          </p>
          <DialogTitle className="relative font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            {current.title}
          </DialogTitle>
          <DialogDescription className="relative mt-3 max-w-xl leading-relaxed">
            {current.description}
          </DialogDescription>
          <ol
            aria-label="Etapas da configuração"
            className="relative mt-6 flex gap-2"
          >
            {STEPS.map((item, index) => (
              <li
                key={item.label}
                aria-current={index === step ? "step" : undefined}
                className="min-w-0 flex-1"
              >
                <div
                  className={cn(
                    "h-1 rounded-full transition-colors motion-reduce:transition-none",
                    index <= step ? "bg-primary" : "bg-primary/15",
                  )}
                />
                <span
                  className={cn(
                    "mt-2 block truncate text-[11px]",
                    index === step
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {item.label}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div
          ref={bodyRef}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6 sm:px-8"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={step}
              initial={{
                opacity: reducedMotion ? 1 : 0,
                y: reducedMotion ? 0 : 10,
              }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: reducedMotion ? 1 : 0,
                y: reducedMotion ? 0 : -6,
              }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
            >
              {step === 0 ? (
                <div className="space-y-5">
                  <p className="text-lg font-medium">
                    Olá,{" "}
                    {session.user?.firstName ||
                      session.user?.displayName ||
                      "que bom ter você aqui"}
                    !
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {STEPS.slice(1).map((item) => (
                      <div
                        key={item.label}
                        className="rounded-xl border border-border bg-background/70 p-4"
                      >
                        <item.icon
                          className="mb-4 size-5 text-primary"
                          aria-hidden
                        />
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    ))}
                  </div>
                  <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-primary"
                      aria-hidden
                    />
                    Tudo é opcional. Use os botões de cada etapa para salvar.
                    Você pode voltar a este guia em Minha conta → Configuração
                    guiada.
                  </p>
                </div>
              ) : step === 1 ? (
                <AvatarSection
                  initials={initialsOf(session.user?.displayName)}
                />
              ) : step === 2 ? (
                <SignatureSection />
              ) : last ? (
                <WelcomeMobileStep />
              ) : profile.isPending ? (
                <PanelLoading rows={3} />
              ) : profile.error || !profile.data ? (
                <PanelError
                  error={profile.error}
                  onRetry={() => void profile.refetch()}
                />
              ) : (
                <MfaSection enabled={profile.data.mfaEnabled} />
              )}
            </motion.div>
          </AnimatePresence>
          <div className="mt-3" role="status" aria-live="polite">
            <MutationError error={update.error} />
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-border bg-muted/20 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <Button variant="ghost" disabled={update.isPending} onClick={dismiss}>
            {update.isPending ? "Salvando…" : "Pular e fazer depois"}
          </Button>
          <div className="flex items-center justify-end gap-2">
            {step > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto sm:mr-0"
                disabled={update.isPending}
                onClick={() => goToStep(step - 1)}
              >
                <ArrowLeft className="size-4" aria-hidden /> Voltar
              </Button>
            ) : null}
            <Button
              disabled={update.isPending}
              onClick={() => (last ? dismiss() : goToStep(step + 1))}
            >
              {last ? "Concluir" : step === 0 ? "Vamos começar" : "Continuar"}
              {last ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <ArrowRight className="size-4" aria-hidden />
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
