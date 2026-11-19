import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";

export function OpenEquipmentInApp({ path }: { path: string }) {
  const label = /^\/q\/([A-Za-z0-9_-]{43})$/.exec(
    path.split(/[?#]/, 1)[0] ?? "",
  )?.[1];
  if (!label) return null;

  return (
    <div className="my-4 flex flex-wrap items-center gap-3 lg:hidden">
      <Button asChild variant="outline" size="sm">
        <a href={`orbit-operator://equipamento/q/${label}`}>
          <Smartphone className="size-4" aria-hidden />
          Abrir no app Orbit
        </a>
      </Button>
      <span className="text-sm text-muted-foreground">
        Você também pode continuar no navegador.
      </span>
    </div>
  );
}
