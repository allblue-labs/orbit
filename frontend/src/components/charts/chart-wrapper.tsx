"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Wrapper that gives every chart the same frame, spacing and header.
 * Charts themselves (Recharts) are composed as children and must read
 * colors from the --color-chart-* tokens.
 */
export function ChartWrapper({
  title,
  description,
  actions,
  children,
  height = 260,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  height?: number;
  className?: string;
}) {
  return (
    /*
      Coluna flexível, e a área do gráfico com altura **mínima** em vez de fixa.
      
      Antes era `height` fixo: um cartão esticado pela grade — o gráfico que divide
      a linha com um painel mais alto — crescia com a moldura e deixava o desenho do
      mesmo tamanho, com vazio embaixo dele. Com `flex-1` sobre `minHeight`, sem
      esticar nada muda (a altura é a mínima) e, esticado, o desenho ocupa o que
      sobrou.
    */
    <Card className={cn("glass-panel flex flex-col", className)}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        <div style={{ minHeight: height }} className="min-h-0 w-full flex-1">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}
