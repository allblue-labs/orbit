"use client";

import {
  Camera,
  Check,
  ClipboardCheck,
  MapPin,
  Smartphone,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { useMobileAppLinks } from "./mobile-app-links.provider";

export const MOBILE_APP_INTRO = {
  title: "O Orbit também vai a campo",
  description:
    "Conheça o app dos técnicos em campo: é nele que todo o atendimento acontece, com o registro das evidências e das informações de cada operação.",
} as const;

const FEATURES = [
  {
    icon: ClipboardCheck,
    title: "Todo o atendimento, no app",
    description:
      "O técnico acompanha as operações e executa cada etapa do serviço em campo.",
  },
  {
    icon: Camera,
    title: "Evidências no lugar certo",
    description:
      "Fotos, checklists e informações ficam registrados na operação durante o atendimento.",
  },
  {
    icon: MapPin,
    title: "Do escritório ao local do serviço",
    description:
      "A equipe leva os dados do atendimento com ela e mantém a gestão informada.",
  },
] as const;

export function OrbitMobilePresentation({
  variant = "welcome",
}: {
  variant?: "welcome" | "landing";
}) {
  const landing = variant === "landing";
  const links = useMobileAppLinks();

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "grid items-center",
          landing
            ? "gap-10 lg:grid-cols-[1.1fr_0.9fr]"
            : "gap-6 sm:grid-cols-[1.15fr_0.85fr]",
        )}
      >
        <div className="space-y-5">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-medium text-primary">
              <Smartphone className="size-3.5" aria-hidden />
              Orbit Mobile
            </span>
            <h3
              className={cn(
                "mt-3 font-display font-semibold tracking-tight",
                landing ? "max-w-lg text-2xl sm:text-3xl" : "text-xl",
              )}
            >
              O próximo atendimento começa na palma da mão.
            </h3>
          </div>
          <ul className="space-y-4">
            {FEATURES.map(({ icon: Icon, title, description }) => (
              <li key={title} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div>
                  <p className="text-sm font-medium">{title}</p>
                  <p
                    className={cn(
                      "mt-1 leading-relaxed text-muted-foreground",
                      landing ? "text-sm" : "text-xs",
                    )}
                  >
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div
          aria-hidden
          className="relative isolate flex min-h-64 items-center justify-center overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-background to-primary/15 p-5"
        >
          <div className="absolute size-52 rounded-full border border-primary/10" />
          <div className="absolute size-72 rounded-full border border-primary/10" />
          <div
            className={cn(
              "relative rotate-3 rounded-[2rem] border-[5px] border-slate-800 bg-slate-950 p-3 shadow-2xl shadow-primary/15",
              landing ? "w-56 sm:w-60" : "w-44",
            )}
          >
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20" />
            <div className="mb-4 flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white dark:bg-slate-800">
                <OrbitLogo variant="mark" className="size-6" />
              </span>
              <span className="text-xs font-semibold text-white">
                Orbit Mobile
              </span>
            </div>
            <p className="text-[10px] uppercase tracking-widest text-cyan-300">
              Em campo
            </p>
            <p className="mt-1 text-sm font-medium text-white">
              Seu atendimento
            </p>
            <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center gap-2 text-[10px] text-white/80">
                <ClipboardCheck className="size-3.5 text-cyan-300" />
                Checklist do serviço
              </div>
              <div className="h-1 rounded-full bg-white/10">
                <div className="h-1 w-2/3 rounded-full bg-cyan-400" />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-white/80">
                <Camera className="size-3.5 text-cyan-300" />
                Evidências da operação
              </div>
              <div className="grid h-12 grid-cols-3 gap-1.5">
                {[0, 1, 2].map((item) => (
                  <span
                    key={item}
                    className="flex items-center justify-center rounded-md bg-gradient-to-br from-cyan-400/20 to-blue-500/10"
                  >
                    <Camera className="size-4 text-cyan-200/70" />
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-center gap-1.5 rounded-lg bg-cyan-400/15 py-2 text-[10px] font-medium text-cyan-200">
              <Check className="size-3" />
              Informações registradas
            </div>
            <div className="mx-auto mt-4 h-1 w-12 rounded-full bg-white/20" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <p className="text-sm font-medium">
          Leve o Orbit para a sua equipe de campo
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Disponível para celulares Android e iPhone.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <StoreLink
            href={links.playStore}
            store="Google Play"
            platform="android"
          />
          <StoreLink href={links.appStore} store="App Store" platform="ios" />
        </div>
      </div>
    </div>
  );
}

function StoreLink({
  href,
  store,
  platform,
}: {
  href: string;
  store: string;
  platform: "android" | "ios";
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Abrir Orbit Mobile na ${store} (nova aba)`}
      className="inline-flex min-h-14 flex-1 items-center justify-center gap-3 rounded-xl border border-white/15 bg-slate-950 px-5 py-2.5 text-white shadow-sm transition hover:-translate-y-0.5 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary motion-reduce:transform-none motion-reduce:transition-none sm:flex-none"
    >
      <svg
        viewBox="0 0 24 24"
        className="size-6 shrink-0"
        fill="currentColor"
        aria-hidden
      >
        {platform === "android" ? (
          <>
            <path fill="#4285f4" d="M3.5 2.5 14 12 3.5 21.5Z" />
            <path fill="#34a853" d="M3.5 2.5 16.5 9.7 14 12Z" />
            <path
              fill="#fbbc04"
              d="m16.5 9.7 3.7 2.1c.2.1.2.3 0 .4l-3.7 2.1L14 12Z"
            />
            <path fill="#ea4335" d="M3.5 21.5 14 12l2.5 2.3Z" />
          </>
        ) : (
          <path d="M17.1 12.3c0-2 1.6-3 1.7-3.1-1-1.4-2.4-1.6-3-1.6-1.3-.1-2.5.8-3.1.8-.6 0-1.6-.8-2.7-.7-1.4 0-2.7.8-3.4 2-1.5 2.5-.4 6.3 1 8.3.7 1 1.5 2 2.6 2 1-.1 1.4-.7 2.7-.7s1.7.7 2.8.7 1.8-1 2.5-2c.8-1.1 1.1-2.2 1.1-2.3-.1 0-2.2-.9-2.2-3.4ZM15 6.3c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.2 1.8-1.1 2.9 1 .1 2.2-.5 2.9-1.3Z" />
        )}
      </svg>
      <span className="text-left">
        <span className="block text-[10px] leading-tight text-white/70">
          Baixe na
        </span>
        <span className="block whitespace-nowrap text-base font-semibold leading-tight">
          {store}
        </span>
      </span>
    </a>
  );
}
