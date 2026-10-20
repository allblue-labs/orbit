"use client";

import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  console.error(error);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Esta página não carregou
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Não foi possível exibir esta página. Tente novamente ou volte ao
          início.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={reset}
            className="bg-gradient-orbit inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Tentar novamente
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent/20"
          >
            Início
          </Link>
        </div>
      </div>
    </div>
  );
}
