"use client";

/**
 * Informações gerais, cliente proprietário e localização.
 *
 * Três blocos que o contrato entrega na mesma leitura — `GET /assets/:id` já
 * inclui unidade e cliente —, então dividi-los em três painéis com três
 * consultas seria desperdício. Continuam visualmente separados.
 *
 * **Localização é texto livre** (`@db.VarChar(255)`): não há coordenadas no
 * modelo `Asset`, e por isso não há mapa nem distância. Inventar geocodificação
 * aqui produziria um ponto no mapa que o cadastro não afirma.
 *
 * **`specifications` é JSON livre** que o backend não interpreta. É
 * apresentado como pares chave/valor, sem tentar adivinhar unidades ou tipos —
 * é o mesmo tratamento que o Field Registry dá ao que não tem forma conhecida.
 */
import { Building2, CalendarDays, MapPin, ShieldCheck } from "lucide-react";

import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { EntityBadge, EntityLink } from "@/entities";
import { formatDate } from "@/lib/formatters";
import type { Asset } from "@/types/assets";

export function OverviewSection({ asset }: { asset: Asset }) {
  return (
    <PanelFrame
      panelId="asset-overview"
      title="Informações gerais"
      actions={
        <EntityBadge entity="asset" group="status" value={asset.status} />
      }
    >
      <div className="space-y-6">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Entry label="Categoria">
            <EntityBadge
              entity="asset"
              group="category"
              value={asset.category}
            />
          </Entry>
          <Entry label="Fabricante">{asset.manufacturer ?? "—"}</Entry>
          <Entry label="Modelo">{asset.model ?? "—"}</Entry>
          <Entry label="Número de série" mono>
            {asset.serialNumber ?? "—"}
          </Entry>
          <Entry label="Instalação">
            <span className="flex items-center gap-1.5">
              <CalendarDays
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
              {asset.installationAt ? formatDate(asset.installationAt) : "—"}
            </span>
          </Entry>
          <Entry label="Garantia até">
            <WarrantyValue warrantyUntil={asset.warrantyUntil} />
          </Entry>
        </dl>

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
            <Building2 className="size-3.5" aria-hidden />
            Proprietário e unidade
          </h3>
          <p className="text-sm">
            <span className="text-muted-foreground">Cliente: </span>
            {asset.customer ? (
              <EntityLink entity="customer" id={asset.customer.id}>
                {asset.customer.tradeName ?? asset.customer.legalName}
              </EntityLink>
            ) : (
              "Ativo próprio da organização"
            )}
            {asset.customer && asset.customer.status !== "ACTIVE" ? (
              <Badge variant="outline" className="ml-2 text-[10px]">
                cliente {asset.customer.status}
              </Badge>
            ) : null}
          </p>
          <p className="text-sm">
            <span className="text-muted-foreground">Unidade: </span>
            {asset.businessUnit
              ? (asset.businessUnit.tradeName ?? asset.businessUnit.legalName)
              : "—"}
          </p>
        </section>

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
            <MapPin className="size-3.5" aria-hidden />
            Localização
          </h3>
          {asset.location ? (
            <p className="text-sm">{asset.location}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem localização cadastrada.
            </p>
          )}
          <p className="text-[10px] text-muted-foreground">
            O cadastro guarda a localização como texto — não há coordenadas no
            contrato, então não há mapa.
          </p>
        </section>

        <Specifications specifications={asset.specifications} />
      </div>
    </PanelFrame>
  );
}

/**
 * Garantia.
 *
 * Mostra a data e nada além dela. **"Em garantia" não é publicado pelo
 * backend**, e derivar o estado comparando com o relógio do navegador criaria
 * um julgamento que o contrato não faz — e que mudaria conforme o fuso de quem
 * abre a tela. Quando o backend publicar o estado, ele entra aqui.
 */
function WarrantyValue({ warrantyUntil }: { warrantyUntil: string | null }) {
  if (!warrantyUntil) return <>—</>;

  return (
    <span className="flex items-center gap-1.5">
      <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden />
      {formatDate(warrantyUntil)}
    </span>
  );
}

function Specifications({
  specifications,
}: {
  specifications: Record<string, unknown> | null;
}) {
  const entries = Object.entries(specifications ?? {});
  if (entries.length === 0) return null;

  return (
    <section className="space-y-2 border-t border-border pt-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase">
        Especificações
      </h3>
      <dl className="grid gap-2 sm:grid-cols-2">
        {entries.map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
            <dd className="text-sm break-words">
              {typeof value === "object" && value !== null
                ? JSON.stringify(value)
                : String(value)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-[10px] text-muted-foreground">
        Campos livres definidos pela organização.
      </p>
    </section>
  );
}

function Entry({
  label,
  children,
  mono,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-1 font-mono text-sm" : "mt-1 text-sm"}>
        {children}
      </dd>
    </div>
  );
}
