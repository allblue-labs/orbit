"use client";
import { Button } from "@/components/ui/button";
export default function LegalError({ reset }: { reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-xl font-semibold">
        Não foi possível abrir o documento
      </h1>
      <p>Tente novamente para ler o texto completo antes de aceitar.</p>
      <Button onClick={reset}>Tentar novamente</Button>
    </div>
  );
}
