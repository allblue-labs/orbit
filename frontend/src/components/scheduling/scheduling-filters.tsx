"use client";

/**
 * Filtros da agenda.
 *
 * Expõe exatamente o que `EventQueryDto` aceita: calendário, unidade,
 * operador, cliente, ativo, segmento e status. Nada é filtrado no cliente — o
 * mesmo recorte alimenta ocorrências, conflitos e inteligência, então filtrar
 * localmente faria os três discordarem.
 *
 * **Operador.** `userId` é filtro real, mas o backend não expõe endpoint que
 * liste os membros da organização — lacuna registrada no manifesto de
 * contratos. O que dá para oferecer com verdade é o recorte do próprio
 * usuário; um seletor de equipe depende de
 * `GET /organizations/current/members` ou equivalente.
 */
import { UserRound, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FilterBar, FilterSelect } from "@/workspace";
import { useSession } from "@/providers/session-provider";
import { schedulingReferencesService } from "@/services/scheduling-references.service";
import {
  SCHEDULING_EVENT_STATUSES,
  type SchedulingCalendar,
  type SchedulingEventQuery,
} from "@/types/scheduling";
import { eventStatusLabel } from "./event-badges";
import { ReferencePicker } from "./reference-picker";

export interface SchedulingFiltersValue {
  calendarId?: string;
  businessUnitId?: string;
  userId?: string;
  customerId?: string;
  assetId?: string;
  status?: SchedulingEventQuery["status"];
}

export function SchedulingFilters({
  value,
  calendars,
  customerLabel,
  assetLabel,
  onChange,
  onReset,
}: {
  value: SchedulingFiltersValue;
  calendars: readonly SchedulingCalendar[];
  customerLabel?: string;
  assetLabel?: string;
  onChange: (
    patch: Partial<SchedulingFiltersValue>,
    labels?: {
      customer?: string;
      asset?: string;
    },
  ) => void;
  onReset: () => void;
}) {
  const session = useSession();
  const mine = value.userId === session.user?.id;
  const hasFilters = Boolean(
    value.calendarId ||
    value.businessUnitId ||
    value.userId ||
    value.customerId ||
    value.assetId ||
    value.status,
  );

  return (
    <FilterBar>
      <FilterSelect
        id="scheduling-calendar"
        label="Calendário"
        value={value.calendarId}
        onChange={(calendarId) => onChange({ calendarId })}
        options={calendars.map((calendar) => ({
          value: calendar.id,
          label: calendar.name,
        }))}
      />

      <FilterSelect
        id="scheduling-unit"
        label="Organização"
        value={value.businessUnitId}
        onChange={(businessUnitId) => onChange({ businessUnitId })}
        options={session.businessUnits.map((unit) => ({
          value: unit.id,
          label: unit.tradeName ?? unit.legalName,
        }))}
        anyLabel="Todas"
      />

      <FilterSelect
        id="scheduling-status"
        label="Status"
        value={value.status}
        onChange={(status) =>
          onChange({ status: status as SchedulingEventQuery["status"] })
        }
        options={SCHEDULING_EVENT_STATUSES.map((status) => ({
          value: status,
          label: eventStatusLabel(status),
        }))}
      />

      <ReferencePicker
        id="scheduling-customer"
        label="Cliente"
        placeholder="Todos"
        value={value.customerId}
        selectedLabel={customerLabel}
        queryKey={schedulingReferencesService.keys.customers}
        fetcher={(search, options) =>
          schedulingReferencesService.customers(search, options)
        }
        toOption={(customer) => ({
          id: customer.id,
          label: customer.tradeName ?? customer.legalName,
        })}
        onChange={(customerId, label) =>
          onChange({ customerId }, { customer: label })
        }
      />

      <ReferencePicker
        id="scheduling-asset"
        label="Ativo"
        placeholder="Todos"
        value={value.assetId}
        selectedLabel={assetLabel}
        queryKey={schedulingReferencesService.keys.assets}
        fetcher={(search, options) =>
          schedulingReferencesService.assets(search, options)
        }
        toOption={(asset) => ({
          id: asset.id,
          label: asset.name,
          hint: asset.identifier,
        })}
        onChange={(assetId, label) => onChange({ assetId }, { asset: label })}
      />

      <div className="col-span-full flex items-end gap-2">
        {session.user ? (
          <Button
            variant={mine ? "default" : "outline"}
            size="sm"
            onClick={() =>
              onChange({ userId: mine ? undefined : session.user?.id })
            }
          >
            <UserRound className="size-4" />
            Alocados a mim
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!hasFilters}
        >
          <X className="size-4" />
          Limpar filtros
        </Button>
      </div>
    </FilterBar>
  );
}
