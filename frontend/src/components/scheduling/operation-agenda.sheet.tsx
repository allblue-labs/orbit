"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PanelError, PanelLoading } from "@/components/panels";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useOperation } from "@/hooks/operations/use-operations";
import { formatZonedTime } from "@/lib/scheduling";
import { ROUTES } from "@/lib/routes";
import { OPERATION_STATUS_LABELS } from "@/types/operations";
import type { SchedulingOccurrence } from "@/types/scheduling";

export function OperationAgendaSheet({
  occurrence,
  operationId,
  timeZone,
  onClose,
}: {
  occurrence: SchedulingOccurrence;
  operationId: string;
  timeZone: string;
  onClose: () => void;
}) {
  const query = useOperation(operationId);
  const operation = query.data;
  const address = operation?.customerAddress;
  const location = address
    ? [
        address.street,
        address.number,
        address.complement,
        address.district,
        address.city,
        address.stateCode,
      ]
        .filter(Boolean)
        .join(", ")
    : operation?.sector;
  const date = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "long",
    timeZone,
  }).format(new Date(occurrence.startsAt));

  return (
    <Sheet
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="pr-8">{occurrence.title}</SheetTitle>
          <SheetDescription>
            {date} · {formatZonedTime(occurrence.startsAt, timeZone)}
            {!occurrence.eventId.startsWith("operation:") ||
            operation?.scheduledEnd
              ? `–${formatZonedTime(occurrence.endsAt, timeZone)}`
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-5 px-4 pb-5">
          {query.isPending ? <PanelLoading rows={4} /> : null}
          {query.error ? (
            <PanelError
              error={query.error}
              onRetry={() => void query.refetch()}
            />
          ) : null}
          {operation ? (
            <>
              <dl className="grid gap-4 rounded-lg border border-border p-4 sm:grid-cols-2">
                <Item
                  label="Referência"
                  value={operation.serviceOrderCode ?? operation.code}
                />
                <Item
                  label="Situação"
                  value={OPERATION_STATUS_LABELS[operation.status]}
                />
                <Item
                  label="Cliente"
                  value={
                    operation.customer?.tradeName ??
                    operation.customer?.legalName
                  }
                />
                <Item
                  label="Técnico em campo"
                  value={operation.responsibleFieldTechnician?.displayName}
                />
                <Item label="Endereço" value={location} />
                <Item
                  label="Equipamentos"
                  value={operation.assets.map(({ name }) => name).join(", ")}
                />
              </dl>
              {operation.description && (
                <p className="whitespace-pre-wrap text-sm">
                  {operation.description}
                </p>
              )}
              <Button asChild>
                <Link href={`${ROUTES.operations}/${operation.id}`}>
                  Abrir operação
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Item({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return value ? (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{value}</dd>
    </div>
  ) : null;
}
