"use client";

/**
 * Paleta de comandos (⌘K).
 *
 * ## O que ela era
 *
 * Uma lista fixa escrita na fase de design: "Operações", "Inventário",
 * "Pessoas", "Relatórios", "Abrir calculadora". Três desses módulos não
 * existem, e **nenhum item navegava** — os `CommandItem` não tinham `onSelect`.
 * Era um menu decorativo.
 *
 * ## O que ela é
 *
 * Dirigida pelos registries. Os destinos vêm do **Entity Registry** (rótulo,
 * ícone, rota, capability) e as ações do **Action Registry** — as mesmas
 * declarações que alimentam o menu lateral e os botões das telas. Um módulo
 * novo aparece aqui por ter sido registrado, não por alguém lembrar de vir
 * editar este arquivo.
 *
 * ## O que ela não faz
 *
 * **Não executa ações.** Ela leva ao lugar onde a ação existe, porque executar
 * exige o contexto que só a tela tem — qual registro, qual formulário, qual
 * confirmação. Uma paleta que dispara mutação sem esse contexto é uma armadilha.
 */
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { allActions } from "@/actions";
import { entityTargets } from "@/navigation";
import { resolveEntity } from "@/entities";
import { useSession } from "@/providers/session-provider";
import { allowsAccess } from "@/registry";
import { cn } from "@/lib/utils";

export function useCommandPalette(
  open: boolean,
  setOpen: (value: boolean) => void,
) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const router = useRouter();
  const session = useSession();

  /** Só os módulos que o plano e o papel desta sessão alcançam. */
  const destinations = useMemo(
    () =>
      entityTargets().filter((target) =>
        allowsAccess(
          {
            capability: target.capability,
            permission: target.permission,
          },
          session,
        ),
      ),
    [session],
  );

  /**
   * Ações de criação, que são as que fazem sentido fora de contexto.
   *
   * "Duplicar" e "Revogar" precisam de um registro selecionado; "Novo ativo"
   * não. Por isso a paleta filtra por superfície `palette`, que o registry já
   * declara.
   */
  const actions = useMemo(
    () =>
      allActions().filter(
        (action) =>
          action.surfaces.includes("palette") && allowsAccess(action, session),
      ),
    [session],
  );

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar módulos e ações…" />
      <CommandList>
        <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

        <CommandGroup heading="Ir para">
          {destinations.map((target) => {
            const Icon = target.icon;
            return (
              <CommandItem
                key={target.id}
                value={`${target.label} ${target.description ?? ""}`}
                onSelect={() => go(target.href)}
              >
                <Icon className="size-4" />
                {target.label}
              </CommandItem>
            );
          })}
        </CommandGroup>

        {actions.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Criar">
              {actions.map((action) => {
                const Icon = action.icon;
                const entity = resolveEntity(action.entity);
                return (
                  <CommandItem
                    key={action.id}
                    value={`${action.label} ${entity.labelPlural}`}
                    /**
                     * Leva à tela da entidade, onde a ação existe de verdade.
                     * A paleta navega; quem executa é a tela.
                     */
                    onSelect={() => go(entity.basePath)}
                  >
                    <Icon className={cn("size-4", entity.color)} />
                    {action.label}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </>
        ) : null}
      </CommandList>
    </CommandDialog>
  );
}
