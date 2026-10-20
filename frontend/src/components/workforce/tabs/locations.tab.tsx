"use client";

/**
 * Onde a equipe reportou estar.
 *
 * ## O título é literal, e importa
 *
 * `GET /workforce/locations` devolve a **última posição reportada** de cada
 * pessoa dentro da janela consultada — não a posição atual. Ninguém é
 * rastreado: o aplicativo de campo envia (`POST /workforce/me/location`, com a
 * identidade de quem envia), e quem não enviou simplesmente não aparece.
 *
 * Silêncio não é ausência. Uma pessoa fora da lista pode estar sem sinal, com
 * o aplicativo fechado, ou de folga — e a tela diz isso em vez de deixar a
 * lista vazia sugerir que ninguém está trabalhando.
 *
 * ## Sem mapa embutido
 *
 * Um mapa exige um provedor externo (tiles, chaves, requisições a outro host),
 * e o Design System não tem esse componente. A tela apresenta as coordenadas
 * com precisão e idade, e um link para abrir no mapa que a pessoa já usa — o
 * que resolve a pergunta sem trazer um terceiro para dentro da aplicação.
 */
import { MapPin, Navigation } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMemberLocations } from "@/hooks/workforce/use-workforce";
import { formatDateTime } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import {
  FilterBar,
  FilterSelect,
  ListState,
  useListController,
} from "@/workspace";

interface LocationFilters {
  withinMinutes?: number;
  page?: number;
  limit?: number;
}

const WINDOW_OPTIONS = [
  { value: "60", label: "Última hora" },
  { value: "240", label: "Últimas 4 horas" },
  { value: "720", label: "Últimas 12 horas" },
  { value: "1440", label: "Últimas 24 horas" },
];

/** Uma posição de horas atrás não responde "onde ele está". */
function freshness(ageMinutes: number): { label: string; className: string } {
  if (ageMinutes <= 15) {
    return { label: "agora há pouco", className: "bg-emerald-500/15 text-emerald-400" };
  }
  if (ageMinutes <= 60) {
    return { label: `há ${ageMinutes} min`, className: "bg-amber-500/15 text-amber-400" };
  }
  const hours = Math.round(ageMinutes / 60);
  return {
    label: `há ${hours} h`,
    className: "bg-surface-strong text-muted-foreground",
  };
}

export function LocationsTab() {
  const list = useListController<LocationFilters>({
    initial: { withinMinutes: 240 },
  });
  const withinMinutes = list.query.withinMinutes ?? 240;
  const query = useMemberLocations(withinMinutes);

  const items = query.data ?? [];

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">
          Última posição <strong>reportada</strong> por cada pessoa dentro da
          janela consultada.
        </p>
        <p className="text-xs text-muted-foreground">
          Quem não aparece não reportou — pode estar sem sinal, com o aplicativo
          fechado ou de folga. Ausência aqui não significa ausência em campo.
        </p>
      </div>

      <FilterBar>
        <FilterSelect
          id="locations-window"
          label="Janela"
          value={String(withinMinutes)}
          onChange={(value) =>
            list.setFilter("withinMinutes", value ? Number(value) : 240)
          }
          options={WINDOW_OPTIONS}
          anyLabel="Últimas 4 horas"
        />
      </FilterBar>

      <ListState
        isPending={query.isPending}
        error={query.error}
        onRetry={() => void query.refetch()}
        items={items}
        empty={{
          icon: <MapPin className="size-5" />,
          title: "Nenhuma posição reportada",
          description:
            "As posições chegam do aplicativo de campo. Nenhuma pessoa reportou dentro desta janela.",
        }}
      >
        {(rows) => (
          <div className="glass-panel overflow-x-auto rounded-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Pessoa</TableHead>
                  <TableHead>Coordenadas</TableHead>
                  <TableHead>Precisão</TableHead>
                  <TableHead>Reportado</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((location) => {
                  const age = freshness(location.ageMinutes);
                  return (
                    <TableRow key={location.userId}>
                      <TableCell className="font-medium">
                        {location.displayName}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {location.latitude.toFixed(5)},{" "}
                        {location.longitude.toFixed(5)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {location.accuracy === null
                          ? "—"
                          : `± ${Math.round(location.accuracy)} m`}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <span
                            className={cn(
                              "inline-flex rounded-md px-2 py-0.5 text-xs font-medium",
                              age.className,
                            )}
                          >
                            {age.label}
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {formatDateTime(location.recordedAt)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        {/*
                          Abre no mapa que a pessoa já usa. Embutir um provedor
                          traria requisições a outro host e uma chave a
                          gerenciar, para responder a mesma pergunta.
                        */}
                        <Button variant="ghost" size="icon" asChild>
                          <a
                            href={`https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=17/${location.latitude}/${location.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Abrir posição de ${location.displayName} no mapa`}
                          >
                            <Navigation className="size-4" />
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </ListState>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">origem</Badge>
        Cada posição traz de onde veio (aplicativo, web ou registro manual), e uma data no futuro não é aceita — um dispositivo com relógio adiantado não
        envenena a ordenação.
      </div>
    </div>
  );
}
