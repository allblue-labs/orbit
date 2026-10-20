"use client";

/**
 * Painéis do Customer Workspace.
 *
 * Todos recebem o cliente já carregado ou a consulta cruzada pronta — nenhum
 * decide o que é vínculo, o que é indicador ou o que é recomendação.
 */
import { useState } from "react";
import {
  Lightbulb,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Star,
  Trash2,
} from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PanelFrame, PanelState, toPanelQuery } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RelatedRecordsPanel } from "@/entities";
import { lifecycleLabel } from "@/registry";
import {
  useCreateContact,
  useUpdateContact,
  useCustomerIntelligence,
  useCustomerSchedule,
  useRemoveContact,
} from "@/hooks/customers/use-customers";
import { formatDateTime } from "@/lib/formatters";
import { MetricCard } from "@/workspace";
import { ROUTES } from "@/lib/routes";
import {
  CUSTOMER_LIMITS,
  type Customer,
  type CustomerContact,
} from "@/types/customers";
import {
  CustomerStatusBadge,
  customerTypeLabel,
  readAddress,
} from "../customer-presentation";

/* ------------------------------------------------------------------ */
/* Geral e endereço                                                    */
/* ------------------------------------------------------------------ */

export function OverviewSection({ customer }: { customer: Customer }) {
  const address = readAddress(customer.address);

  return (
    <PanelFrame
      panelId="customer-overview"
      title="Informações gerais"
      actions={<CustomerStatusBadge status={customer.status} />}
    >
      <div className="space-y-5">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Entry label="Razão social">{customer.legalName}</Entry>
          <Entry label="Nome fantasia">{customer.tradeName ?? "—"}</Entry>
          <Entry label="Tipo">{customerTypeLabel(customer.type)}</Entry>
          <Entry label="Documento" mono>
            {customer.documentNumber
              ? `${customer.documentType ?? ""} ${customer.documentNumber}`.trim()
              : "—"}
          </Entry>
          <Entry label="E-mail">{customer.email ?? "—"}</Entry>
          <Entry label="Telefone">{customer.phone ?? "—"}</Entry>
        </dl>

        <section className="space-y-2 border-t border-border pt-4">
          <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase">
            <MapPin className="size-3.5" aria-hidden />
            Endereço
          </h3>
          {address.line || address.city ? (
            <p className="text-sm">
              {address.line}
              {address.line && address.city ? " — " : ""}
              {address.city}
              {address.stateCode ? `/${address.stateCode}` : ""}
              {address.known.postalCode ? ` · ${address.known.postalCode}` : ""}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Sem endereço cadastrado.
            </p>
          )}
          {Object.keys(address.extra).length > 0 ? (
            <dl className="grid gap-1 sm:grid-cols-2">
              {Object.entries(address.extra).map(([key, value]) => (
                <div key={key}>
                  <dt className="font-mono text-[10px] text-muted-foreground">
                    {key}
                  </dt>
                  <dd className="text-xs">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <p className="text-[10px] text-muted-foreground">
            O endereço é texto livre, sem coordenadas nem mapa.
          </p>
        </section>

        {customer.notes ? (
          <section className="space-y-1 border-t border-border pt-4">
            <h3 className="text-xs font-medium text-muted-foreground uppercase">
              Observações
            </h3>
            <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
          </section>
        ) : null}
      </div>
    </PanelFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Contatos                                                            */
/* ------------------------------------------------------------------ */

/**
 * Contatos.
 *
 * Vêm embutidos no detalhe do cliente, já ordenados pelo backend
 * (`isPrimary desc, name asc`) — não há segunda consulta. As escritas usam o
 * sub-recurso `/customers/:id/contacts` e invalidam o detalhe, que é quem
 * publica a lista.
 */
export function ContactsSection({
  customer,
  canManage,
}: {
  customer: Customer;
  canManage: boolean;
}) {
  const create = useCreateContact(customer.id);
  const update = useUpdateContact(customer.id);
  const remove = useRemoveContact(customer.id);

  /** `null` fechado; `"new"` criando; um contato editando. */
  const [editando, setEditando] = useState<CustomerContact | "new" | null>(
    null,
  );
  const alvo = editando === "new" ? null : editando;
  const mutation = alvo ? update : create;

  return (
    <PanelFrame
      panelId="customer-contacts"
      title="Contatos"
      description={`${customer.contacts.length} cadastrado(s)`}
      actions={
        canManage ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              setEditando((atual) => (atual === null ? "new" : null))
            }
          >
            {editando !== null ? "Cancelar" : "Novo contato"}
          </Button>
        ) : null
      }
    >
      <div className="space-y-4">
        {editando !== null ? (
          <ContactForm
            /* `key` remonta o formulário ao trocar de contato: sem isso os
               campos do anterior sobreviveriam à troca. */
            key={alvo?.id ?? "new"}
            contact={alvo}
            pending={mutation.isPending}
            onSubmit={(input) => {
              const fechar = { onSuccess: () => setEditando(null) };
              if (alvo) {
                update.mutate({ contactId: alvo.id, input }, fechar);
              } else {
                create.mutate(input, fechar);
              }
            }}
          />
        ) : null}

        <MutationError error={mutation.error ?? remove.error} />

        {customer.contacts.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhum contato cadastrado para este cliente.
          </p>
        ) : (
          <ul className="space-y-2">
            {customer.contacts.map((contact) => (
              <ContactRow
                key={contact.id}
                contact={contact}
                canManage={canManage}
                removing={remove.isPending}
                onEdit={() => setEditando(contact)}
                onRemove={() => remove.mutate(contact.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </PanelFrame>
  );
}

function ContactRow({
  contact,
  canManage,
  removing,
  onEdit,
  onRemove,
}: {
  contact: CustomerContact;
  canManage: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {contact.name}
          {contact.isPrimary ? (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Star className="size-2.5" aria-hidden />
              principal
            </Badge>
          ) : null}
          {contact.role ? (
            <span className="text-xs font-normal text-muted-foreground">
              {contact.role}
            </span>
          ) : null}
        </p>
        <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {contact.email ? (
            <span className="flex items-center gap-1">
              <Mail className="size-3" aria-hidden />
              {contact.email}
            </span>
          ) : null}
          {contact.phone ? (
            <span className="flex items-center gap-1">
              <Phone className="size-3" aria-hidden />
              {contact.phone}
            </span>
          ) : null}
        </p>
      </div>

      {canManage ? (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            onClick={onEdit}
            aria-label={`Editar ${contact.name}`}
          >
            <Pencil className="size-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-8 text-destructive"
            disabled={removing}
            onClick={onRemove}
            aria-label={`Remover ${contact.name}`}
          >
            <Trash2 className="size-4" />
          </Button>
        </>
      ) : null}
    </li>
  );
}

function ContactForm({
  contact,
  pending,
  onSubmit,
}: {
  /** `null` cria; preenchido edita. */
  contact: CustomerContact | null;
  pending: boolean;
  onSubmit: (input: {
    name: string;
    role?: string;
    email?: string;
    phone?: string;
  }) => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [role, setRole] = useState(contact?.role ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");

  return (
    <div className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="contact-name">Nome</Label>
        <Input
          id="contact-name"
          value={name}
          maxLength={CUSTOMER_LIMITS.contactNameMaxLength}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-role">Função</Label>
        <Input
          id="contact-role"
          value={role}
          maxLength={CUSTOMER_LIMITS.contactRoleMaxLength}
          onChange={(event) => setRole(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-email">E-mail</Label>
        <Input
          id="contact-email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contact-phone">Telefone</Label>
        <Input
          id="contact-phone"
          value={phone}
          maxLength={CUSTOMER_LIMITS.phoneMaxLength}
          onChange={(event) => setPhone(event.target.value)}
        />
      </div>
      <Button
        className="sm:col-span-2"
        disabled={name.trim().length < 2 || pending}
        onClick={() =>
          onSubmit({
            name: name.trim(),
            role: role.trim() || undefined,
            email: email.trim() || undefined,
            phone: phone.trim() || undefined,
          })
        }
      >
        {pending
          ? "Salvando…"
          : contact
            ? "Salvar contato"
            : "Adicionar contato"}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Vínculos                                                            */
/* ------------------------------------------------------------------ */

export function CustomerScheduleSection({
  customerId,
}: {
  customerId: string;
}) {
  const query = useCustomerSchedule(customerId);

  return (
    <RelatedRecordsPanel
      entity="scheduling-event"
      panelId="customer-schedule"
      title="Agenda futura"
      description="Próximos 90 dias, incluindo compromissos recorrentes"
      query={query}
      emptyMessage="Nada agendado para este cliente nos próximos 90 dias."
      seeAllHref={ROUTES.scheduling}
      toRows={(occurrences) =>
        occurrences.slice(0, 5).map((occurrence) => ({
          key: occurrence.occurrenceId,
          entityId: occurrence.eventId,
          title: occurrence.title,
          subtitle: `${formatDateTime(occurrence.startsAt)} · ${occurrence.type}`,
          status: occurrence.status,
        }))
      }
    />
  );
}

/* ------------------------------------------------------------------ */
/* Indicadores                                                         */
/* ------------------------------------------------------------------ */

/**
 * Indicadores do cliente.
 *
 * **Os dois primeiros vêm prontos do backend.** O `include` do repositório
 * traz `_count: { assets, operations }`, contado no banco e já excluindo
 * registros removidos. Não há soma no cliente.
 *
 * A apresentação — rótulo, ícone, cor, formato, descrição — passa pelo Metric
 * Registry, com definições registradas para os ids abaixo.
 *
 * O que **não** está aqui: receita, ticket médio, tempo de resposta e
 * inadimplência. São indicadores legítimos de gestão de carteira e nenhum tem
 * fonte — o Analytics é escopado por unidade e período, não por cliente.
 */
export function IndicatorsSection({ customer }: { customer: Customer }) {
  return (
    <PanelFrame
      panelId="customer-indicators"
      title="Indicadores"
      description="Contagens deste cliente"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          size="sm"
          showDescription
          metricId="customer.assets.total"
          value={customer.counts.assets}
        />
        <MetricCard
          size="sm"
          showDescription
          metricId="customer.operations.total"
          value={customer.counts.operations}
        />
      </div>

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        Receita, ticket médio e tempo de resposta ainda não estão disponíveis
        por cliente. Os indicadores existentes são por unidade e período.
      </p>
    </PanelFrame>
  );
}

/* ------------------------------------------------------------------ */
/* Orbit Intelligence                                                  */
/* ------------------------------------------------------------------ */

/**
 * Orbit Intelligence do cliente.
 *
 * **Este é o primeiro Workspace de entidade com fonte de IA de verdade.**
 * `AiExecutionQueryDto` aceita `customerId`, então as execuções listadas são as
 * que o backend associou a este cliente — diferente do Asset Workspace, onde
 * nenhum endpoint tem escopo de equipamento.
 *
 * `output` é JSON livre, definido pelo agente que executou. O painel lê as
 * chaves usuais quando existem e declara "formato não reconhecido" quando não
 * encontra nenhuma — assumir estrutura quebraria no primeiro agente diferente.
 *
 * **Nada é gerado aqui.**
 */
export function IntelligenceSection({
  customerId,
  enabled,
}: {
  customerId: string;
  enabled: boolean;
}) {
  const query = useCustomerIntelligence(customerId, enabled);

  if (!enabled) {
    return (
      <PanelFrame
        panelId="customer-intelligence"
        title="Orbit Intelligence"
        description="Análises associadas a este cliente"
      >
        <p className="py-6 text-center text-sm text-muted-foreground">
          O plano desta organização não inclui a leitura de execuções de IA.
        </p>
      </PanelFrame>
    );
  }

  return (
    <PanelFrame
      panelId="customer-intelligence"
      title="Orbit Intelligence"
      description="Execuções de IA associadas a este cliente"
    >
      <PanelState
        query={toPanelQuery(query)}
        loadingRows={3}
        isEmpty={(page) => page.data.length === 0}
        emptyMessage="Nenhuma análise registrada para este cliente."
      >
        {(page) => (
          <ul className="space-y-2">
            {page.data.map((execution) => (
              <li
                key={execution.id}
                className="space-y-1 rounded-lg border border-border px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Lightbulb
                    className="size-4 shrink-0 text-amber-400"
                    aria-hidden
                  />
                  <span className="text-sm font-medium">
                    {execution.purpose}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {lifecycleLabel(execution.status)}
                  </Badge>
                </div>
                <IntelligenceOutput output={execution.output} />
                <p className="text-[10px] text-muted-foreground">
                  {formatDateTime(execution.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelState>

      <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        O conteúdo é definido pela análise que foi executada. Nada é gerado
        neste navegador.
      </p>
    </PanelFrame>
  );
}

/** Chaves usuais em `output`. Ausentes todas, o formato é declarado desconhecido. */
const OUTPUT_KEYS = [
  ["summary", "Resumo"],
  ["alerts", "Alertas"],
  ["recommendations", "Recomendações"],
  ["opportunities", "Oportunidades"],
  ["observations", "Observações"],
  ["insights", "Observações"],
] as const;

function IntelligenceOutput({ output }: { output: unknown }) {
  if (!output || typeof output !== "object") {
    return (
      <p className="text-xs text-muted-foreground">
        Sem saída registrada para esta execução.
      </p>
    );
  }

  const record = output as Record<string, unknown>;
  const blocks = OUTPUT_KEYS.filter(([key]) => record[key] !== undefined);

  if (blocks.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Saída em formato não reconhecido por esta versão da interface.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {blocks.map(([key, label]) => {
        const value = record[key];
        return (
          <div key={key} className="text-xs">
            <span className="text-muted-foreground">{label}: </span>
            {Array.isArray(value) ? (
              <span>{value.map((item) => String(item)).join(" · ")}</span>
            ) : (
              <span>{String(value)}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Histórico                                                           */
/* ------------------------------------------------------------------ */

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
