"use client";

/**
 * Moldura comum de painel.
 *
 * Concentra o que todo painel de dado remoto precisa e nenhum deve
 * reimplementar: cabeçalho, carregamento, erro, vazio, acesso negado e Error
 * Boundary local. Vale para widgets do Dashboard e para as seções do
 * Operations Workspace.
 *
 * Nenhuma regra de autorização vive aqui: o backend decide o que responde, e
 * o 403 é apresentado como ausência de acesso.
 */
import type { ReactNode } from "react";
import {
  CircleOff,
  FileQuestion,
  Lock,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";

import { ChartWrapper } from "@/components/charts/chart-wrapper";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError } from "@/lib/api-error";
import { errorCopy } from "@/lib/error-copy";
import { cn } from "@/lib/utils";
import { PanelErrorBoundary } from "./panel-error-boundary";

/** Resultado de uma consulta, no formato que os painéis consomem. */
export interface PanelQuery<TData> {
  data: TData | undefined;
  isPending: boolean;
  error: unknown;
  refetch: () => void;
}

export interface PanelFrameProps {
  panelId: string;
  title: string;
  description?: string;
  /** Renderizado à direita do cabeçalho (marcas, filtros, contadores, ações). */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function PanelFrame({
  panelId,
  title,
  description,
  actions,
  className,
  children,
}: PanelFrameProps) {
  return (
    /**
     * A altura é a do conteúdo.
     *
     * O painel trazia `h-full`, que só faz sentido para emparelhar cartões
     * lado a lado. Numa coluna empilhada dentro de uma grade, a coluna estica
     * até a altura da linha e cada `h-full` vira 100% *disso*: em Organização,
     * sete painéis de 200 a 700px de conteúdo passaram a medir 4611px cada, e
     * a página inteira, 18.773px — quase tudo vazio. Quem precisa emparelhar
     * pede `className="h-full"`, que é a exceção e não a regra.
     *
     * `panelId` já identificava o painel para os estados de carga e de erro;
     * agora também no DOM. É um marcador, não semântica: não vira landmark
     * (dezenas de `region` numa página são ruído para quem navega por eles) e
     * não muda nada do que se vê.
     */
    <Card data-panel={panelId} className={cn("glass-panel", className)}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0 space-y-1">
          {/*
            * O título do painel é um cabeçalho de verdade.
            *
            * `CardTitle` desenha um `div`: bonito e mudo. Com dezenas de
            * painéis por página, quem navega por cabeçalhos ia do `h1` da
            * página direto para os `h3` escritos dentro das seções, sem nada
            * que dissesse onde cada bloco começa. `h2` é o nível certo — o
            * painel é uma seção logo abaixo do título da página.
            */}
          <h2 className="text-base font-semibold leading-none tracking-tight">
            {title}
          </h2>
          {description ? (
            <CardDescription>{description}</CardDescription>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </CardHeader>
      <CardContent>
        <PanelErrorBoundary
          panelId={panelId}
          fallback={(error) => <PanelRenderFailure error={error} />}
        >
          {children}
        </PanelErrorBoundary>
      </CardContent>
    </Card>
  );
}

/**
 * Moldura para painéis de gráfico.
 *
 * Usa o `ChartWrapper` do Design System — que já é um card com cabeçalho — em
 * vez do `PanelFrame`, evitando cartão dentro de cartão.
 */
export function PanelChartFrame({
  panelId,
  title,
  description,
  actions,
  height = 300,
  className,
  children,
}: PanelFrameProps & { height?: number }) {
  return (
    <ChartWrapper
      title={title}
      description={description}
      actions={actions}
      height={height}
      className={className}
    >
      <PanelErrorBoundary
        panelId={panelId}
        fallback={(error) => <PanelRenderFailure error={error} />}
      >
        {children}
      </PanelErrorBoundary>
    </ChartWrapper>
  );
}

/**
 * Máquina de estados de uma leitura.
 *
 * Carregando → erro → vazio → dados, em um único lugar. Os painéis recebem o
 * dado já resolvido e não repetem a cadeia de condicionais.
 */
export function PanelState<TData>({
  query,
  children,
  loadingRows,
  isEmpty,
  emptyMessage,
}: {
  query: PanelQuery<TData>;
  loadingRows?: number;
  /** Vazio semântico do painel (ex.: lista sem itens). */
  isEmpty?: (data: TData) => boolean;
  emptyMessage?: string;
  children: (data: TData) => ReactNode;
}) {
  if (query.isPending) return <PanelLoading rows={loadingRows} />;
  if (query.error) {
    return <PanelError error={query.error} onRetry={query.refetch} />;
  }
  if (query.data === undefined) return <PanelEmpty message={emptyMessage} />;
  if (isEmpty?.(query.data)) return <PanelEmpty message={emptyMessage} />;
  return <>{children(query.data)}</>;
}

/** Carregamento — mantém a altura do painel estável. */
export function PanelLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton
          key={index}
          className={cn("h-4 w-full", index === 0 && "h-8 w-2/3")}
        />
      ))}
    </div>
  );
}

/** Vazio legítimo: a consulta respondeu, mas não há dados. */
export function PanelEmpty({
  message = "Nenhum dado disponível.",
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
      <CircleOff className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Erro de leitura.
 *
 * 403 é tratado à parte: o backend recusou por permissão, plano ou
 * capability — não é falha, é ausência de acesso, e não oferece "tentar
 * novamente".
 */
export function PanelError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const apiError = error instanceof ApiError ? error : null;

  if (apiError?.isForbidden) return <PanelAccessDenied />;
  if (apiError?.isNotFound) return <PanelMissing />;

  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-3 text-center">
      <TriangleAlert className="size-5 text-destructive" aria-hidden />
      <div className="space-y-1">
        <p className="text-sm font-medium">Não foi possível carregar</p>
        <p className="text-xs text-muted-foreground">
          {errorCopy(error)}
        </p>
        {/**
         * A referência que o suporte pede.
         *
         * O backend devolve `requestId` em toda resposta de erro e ele
         * atravessa log, auditoria e fila com o mesmo valor. Mostrá-lo aqui —
         * discreto, selecionável — transforma "deu erro" em algo rastreável.
         * Só aparece quando existe: inventar um código atrapalharia mais que
         * a ausência.
         */}
        {apiError?.requestId ? (
          <p className="pt-1 font-mono text-[11px] text-muted-foreground/70 select-all">
            Código de referência: {apiError.requestId}
          </p>
        ) : null}
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="size-3.5" />
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Registro ausente — e ausência é só isso.
 *
 * O backend responde `Operation with identifier 01a0… was not found`: nome
 * interno da entidade, em inglês, com o identificador de volta. Serve ao log,
 * não à tela. E a interface não deve tentar distinguir os três casos que
 * produzem 404 — não existe, é de outro inquilino, é de outra unidade —,
 * porque a diferença entre eles é justamente o que o isolamento esconde.
 *
 * Uma frase só, em português, para os três.
 */
export function PanelMissing({
  message = "Este registro não está disponível.",
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
      <FileQuestion className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/** Acesso negado pelo backend (permissão, papel, plano ou capability). */
export function PanelAccessDenied({
  message = "Sua conta não tem acesso a esta informação.",
}: {
  message?: string;
}) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
      <Lock className="size-5 text-muted-foreground" aria-hidden />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/**
 * Painel sem fonte de dado real no backend.
 *
 * Declarar a ausência é preferível a exibir número inventado.
 */
export function PanelWithoutSource({ reason }: { reason: string }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
      <CircleOff className="size-5 text-muted-foreground" aria-hidden />
      <p className="max-w-sm text-sm text-muted-foreground">{reason}</p>
    </div>
  );
}

function PanelRenderFailure({ error }: { error: Error }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-2 text-center">
      <TriangleAlert className="size-5 text-destructive" aria-hidden />
      <p className="text-sm font-medium">Painel indisponível</p>
      <p className="max-w-sm text-xs text-muted-foreground">
        {process.env.NODE_ENV === "production"
          ? "Este painel não pôde ser exibido. O restante da página continua funcionando."
          : error.message}
      </p>
    </div>
  );
}
