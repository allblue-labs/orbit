"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/**
 * A raiz é dona do ritmo entre a lista de abas e o painel.
 *
 * Antes ninguém era: o primitivo dava `mt-2` ao painel, cada workspace dava
 * `space-y-4|5|6` à raiz, e páginas como a Agenda ainda embrulhavam a lista
 * num contêiner com `py-6`. As três fontes somavam-se, e o mesmo componente
 * abria com 28px numa página e 73px noutra. Uma `gap` única aqui é a regra —
 * quem usa não passa mais espaçamento vertical próprio.
 */
const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Root
    ref={ref}
    className={cn("flex flex-col gap-4", className)}
    {...props}
  />
));
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      /**
       * Respiro entre as abas.
       *
       * Sem `gap` os gatilhos encostam um no outro e a faixa lê-se como um
       * bloco cinzento com palavras dentro — só a aba ativa, por ter fundo
       * próprio, se separa. Quatro pixels bastam para cada aba virar um alvo
       * reconhecível sem afrouxar o grupo.
       */
      "gap-1",
      /**
       * Altura mínima, não fixa.
       *
       * Era `h-9`. Qualquer aba um pixel mais alta que o normal — uma borda, um
       * ícone maior — não caber nessa altura exata não alargava a faixa: com
       * `overflow-x-auto` ligado, o excedente virava **rolagem vertical** numa
       * barra de 36px, e foi assim que o Financeiro passou a rolar. Com mínimo,
       * a faixa cresce no caso raro e fica idêntica no caso comum.
       */
      "min-h-9",
      /**
       * A raiz é uma coluna flex, e um item de coluna estica por padrão. Sem
       * isto a faixa cinzenta das abas atravessaria a página inteira, em vez
       * de acompanhar a largura das próprias abas.
       */
      "self-start",
      /**
       * A lista rola dentro de si, em vez de empurrar a página.
       *
       * `inline-flex` sem limite adota a largura intrínseca das abas: em
       * Equipe e Configurações isso dava ~920px e, a 768px, o documento
       * inteiro passava a rolar na horizontal — o shell junto. Rolar aqui
       * mantém o problema dentro do componente, que é onde ele cabe.
       *
       * No desktop nada muda: `max-w-full` só age quando falta espaço.
       */
      "max-w-full overflow-x-auto",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      /**
       * `min-w-0` porque um item de flex não encolhe abaixo do conteúdo por
       * omissão: uma tabela larga dentro do painel empurraria a página para a
       * rolagem horizontal em vez de rolar dentro de si.
       */
      "min-w-0 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
