"use client";

/**
 * A navegação em telas estreitas.
 *
 * Abaixo de `lg` o menu fixo é `hidden`, e o botão do cabeçalho não tinha
 * `onClick`: a navegação principal do produto simplesmente não existia em
 * tablet nem em celular — medido na H06, a 768px a barra lateral tinha largura
 * zero e nada a substituía.
 *
 * A gaveta usa o `Sheet` que o produto já tem, e com ele vêm de graça as três
 * coisas que um menu modal precisa acertar: o foco entra e fica preso dentro,
 * `Escape` fecha, e ao fechar o foco volta para o botão que a abriu.
 *
 * **Uma lista só.** Os grupos e itens são os mesmos do menu fixo, lidos da
 * mesma estrutura — não há uma segunda navegação escrita à mão que envelheça
 * quando um módulo entra ou sai.
 */
import { useState } from "react";
import { Menu } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ActiveContext,
  NavigationGroups,
  defaultNavigation,
  type NavItem,
} from "@/components/layout/sidebar";

export function MobileNav({
  navigation = defaultNavigation,
  activeLabel,
}: {
  navigation?: { group: string; items: NavItem[] }[];
  activeLabel?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/*
        * O gatilho vive dentro do `Sheet` de propósito: é assim que o Radix
        * sabe para onde devolver o foco quando a gaveta fecha. Com o botão
        * fora, `Escape` fechava e o foco ficava no corpo da página.
        */}
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Abrir menu"
          className="lg:hidden"
        >
          <Menu className="size-4" />
        </Button>
      </SheetTrigger>

      <SheetContent
        side="left"
        className="flex w-[min(20rem,85vw)] flex-col gap-0 bg-sidebar p-0"
      >
        <SheetHeader className="px-4 pt-4 pb-2 text-left">
          <SheetTitle className="text-sm">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Navegação principal do Orbit
          </SheetDescription>
        </SheetHeader>

        <ActiveContext />

        {/* A lista rola dentro da gaveta: dezessete itens não cabem em 375px. */}
        <NavigationGroups
          navigation={navigation}
          collapsed={false}
          activeLabel={activeLabel}
          onNavigate={() => setOpen(false)}
          className="min-h-0 overflow-y-auto pb-4"
        />
      </SheetContent>
    </Sheet>
  );
}
