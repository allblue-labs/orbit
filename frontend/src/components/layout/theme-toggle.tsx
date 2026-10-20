"use client";

/**
 * Alternador de tema.
 *
 * Ocupa o lugar de um botão que não fazia nada: um ícone de "alternar painéis"
 * sem `onClick`, que existia desde o primeiro esqueleto da topbar e prometia
 * um recurso inexistente.
 *
 * ## Três opções, e `system` é o padrão
 *
 * "Sistema" segue o computador e acompanha a mudança ao anoitecer sem
 * recarregar. As outras duas são escolhas explícitas, e ganham da preferência
 * do sistema até alguém voltar atrás.
 *
 * O ícone mostra o que está **pintado agora**, não o que foi escolhido: em
 * "Sistema" ele vira lua quando o computador vira escuro, que é o que a pessoa
 * vê na tela.
 */
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useThemePreference } from "@/components/layout/theme-preference";
import { THEMES, type Theme } from "@/components/layout/theme-cookie";
import { cn } from "@/lib/utils";

const OPCOES: Readonly<
  Record<Theme, { label: string; icon: typeof Sun; hint: string }>
> = {
  system: {
    label: "Sistema",
    icon: Monitor,
    hint: "Segue o tema do seu computador",
  },
  light: { label: "Claro", icon: Sun, hint: "Sempre claro" },
  dark: { label: "Escuro", icon: Moon, hint: "Sempre escuro" },
};

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolved, setTheme } = useThemePreference();
  const Icone = resolved === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(className)}
          aria-label={`Tema: ${OPCOES[theme].label}`}
        >
          <Icone className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {THEMES.map((opcao) => {
          const { label, icon: OpcaoIcone, hint } = OPCOES[opcao];
          return (
            <DropdownMenuCheckboxItem
              key={opcao}
              checked={theme === opcao}
              onCheckedChange={() => setTheme(opcao)}
            >
              <OpcaoIcone className="size-4" />
              <span className="flex flex-col">
                {label}
                <span className="text-xs text-muted-foreground">{hint}</span>
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
