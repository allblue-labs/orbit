"use client";

/**
 * Cadastro e edição de cliente.
 *
 * Escreve em `POST /customers` e `PATCH /customers/:id`. Oferece exatamente o
 * que `CreateCustomerDto` aceita — tipo, razão social, nome fantasia,
 * documento, e-mail, telefone, observações e endereço — e nada além.
 *
 * ## O que não é decidido aqui
 *
 * - **Situação na criação.** `CreateCustomerDto` não tem o campo; o registro
 *   nasce ativo. A escolha só existe na edição, onde o contrato a publica.
 * - **Organização e unidade.** O cliente é da organização, e ela vem do token.
 *   Não há campo de tenant a preencher nem a enviar.
 * - **Documento repetido.** O banco tem índice único por organização, tipo e
 *   número. A tela não pergunta antes: a resposta envelheceria no instante
 *   seguinte. O conflito volta do servidor e aparece como veio.
 * - **Contatos.** São sub-recurso, com requisição própria. Emendá-los ao
 *   cadastro faria uma transação de mentira — falhando a segunda chamada, o
 *   cliente já existiria sem o contato.
 *
 * A forma do estado, o corpo da requisição e o que a tela recusa sozinha
 * moram em `@/lib/customer-form`, sem tela e sob teste.
 */
import { useRef, useState } from "react";

import { PostalCodeField } from "@/components/address/postal-code-field";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/customers/use-customers";
import { formatBrazilianDocument } from "@/lib/brazilian-document";
import {
  customerFormIssues,
  customerPayload,
  customerUpdatePayload,
  initialCustomerForm,
  type CustomerFormState,
} from "@/lib/customer-form";
import type { PostalAddress } from "@/lib/postal-code";
import { cn } from "@/lib/utils";
import { CustomerStatus, CustomerType } from "@/types/contracts";
import { CUSTOMER_LIMITS, type Customer } from "@/types/customers";
import { customerStatusLabel, customerTypeLabel } from "./customer-presentation";

const TYPE_OPTIONS = Object.values(CustomerType);
const STATUS_OPTIONS = Object.values(CustomerStatus);

/** Rótulos do endereço. O backend não define esquema; estas são as chaves que o produto já lê. */
/** O CEP tem campo próprio: é ele que preenche o resto. */
const ADDRESS_LABELS = [
  ["street", "Logradouro"],
  ["number", "Número"],
  ["complement", "Complemento"],
  ["district", "Bairro"],
  ["city", "Cidade"],
  ["stateCode", "UF"],
  ["state", "Estado"],
  ["country", "País"],
] as const;

export function CustomerFormDialog({
  open,
  onOpenChange,
  editing = null,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Customer | null;
  onSaved?: (customer: Customer) => void;
}) {
  /**
   * O corpo só existe enquanto o diálogo está aberto, e a `key` o recria.
   * Fechar e abrir de novo começa em branco, em vez de guardar o que ficou.
   */
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <Body
          key={editing?.id ?? "novo"}
          editing={editing}
          onOpenChange={onOpenChange}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  editing,
  onOpenChange,
  onSaved,
}: {
  editing: Customer | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (customer: Customer) => void;
}) {
  const [form, setForm] = useState<CustomerFormState>(() =>
    initialCustomerForm(editing),
  );
  /** As mensagens só aparecem depois da primeira tentativa de enviar. */
  const [submitted, setSubmitted] = useState(false);

  const create = useCreateCustomer();
  const update = useUpdateCustomer(editing?.id ?? "");
  const mutation = editing ? update : create;

  const set = <TKey extends keyof CustomerFormState>(
    key: TKey,
    value: CustomerFormState[TKey],
  ) => setForm((current) => ({ ...current, [key]: value }));

  const setAddress = (key: string, value: string) =>
    setForm((current) => ({
      ...current,
      address: { ...current.address, [key]: value },
    }));

  /**
   * O endereço que o CEP trouxe.
   *
   * Número e complemento ficam como estavam: o CEP conhece a rua, não a porta.
   */
  const preencherEndereco = (endereco: PostalAddress) =>
    setForm((current) => ({
      ...current,
      address: {
        ...current.address,
        postalCode: endereco.postalCode,
        street: endereco.street,
        district: endereco.district,
        city: endereco.city,
        state: endereco.state,
        stateCode: endereco.stateCode,
        country: endereco.country,
      },
    }));

  const issues = customerFormIssues(form);
  const blocked = Object.keys(issues).length > 0;
  const show = (field: keyof typeof issues) =>
    submitted ? issues[field] : undefined;

  /**
   * A ligação campo → mensagem.
   *
   * `aria-describedby` tem de estar no próprio controlo: num embrulho, o
   * leitor de tela anuncia o valor sem o motivo da recusa.
   */
  const described = (field: keyof typeof issues) =>
    show(field)
      ? { "aria-describedby": `customer-${field}-erro`, "aria-invalid": true }
      : {};

  /**
   * O trinco do envio.
   *
   * O botão desabilita enquanto a escrita corre, e isso basta para um clique
   * duplo humano — há render entre um clique e outro. Não basta para dois
   * cliques no mesmo tick, em que o React ainda não redesenhou: aí seriam dois
   * `POST` e dois clientes. Um `ref` fecha antes de qualquer render.
   */
  const sending = useRef(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (sending.current) return;
    setSubmitted(true);
    if (blocked) {
      /** Foco no primeiro campo recusado, para quem navega pelo teclado. */
      const first = Object.keys(issues)[0];
      document.getElementById(`customer-${first}`)?.focus();
      return;
    }

    const done = (customer: Customer) => {
      onSaved?.(customer);
      onOpenChange(false);
    };
    /** Recusado pelo servidor, o formulário volta a aceitar envio. */
    const release = () => {
      sending.current = false;
    };

    sending.current = true;
    if (editing) {
      update.mutate(customerUpdatePayload(form), {
        onSuccess: done,
        onError: release,
      });
      return;
    }
    create.mutate(customerPayload(form), { onSuccess: done, onError: release });
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <DialogHeader>
        <DialogTitle>{editing ? "Editar cliente" : "Novo cliente"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "As alterações valem para toda a organização."
            : "O cliente passa a existir para toda a organização. Contatos e equipamentos são cadastrados depois, na ficha dele."}
        </DialogDescription>
      </DialogHeader>

      <Section title="Dados principais">
        <Field label="Tipo" htmlFor="customer-type">
          <Select
            value={form.type}
            onValueChange={(value) => set("type", value as CustomerFormState["type"])}
          >
            <SelectTrigger id="customer-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TYPE_OPTIONS.map((type) => (
                <SelectItem key={type} value={type}>
                  {customerTypeLabel(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {editing ? (
          <Field label="Situação" htmlFor="customer-status">
            <Select
              value={form.status}
              onValueChange={(value) =>
                set("status", value as CustomerFormState["status"])
              }
            >
              <SelectTrigger id="customer-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {customerStatusLabel(status)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}

        <Field
          label="Razão social ou nome"
          htmlFor="customer-legalName"
          required
          error={show("legalName")}
          className="sm:col-span-2"
        >
          <Input
            id="customer-legalName"
            {...described("legalName")}
            value={form.legalName}
            onChange={(event) => set("legalName", event.target.value)}
            maxLength={CUSTOMER_LIMITS.legalNameMaxLength}
            autoFocus
          />
        </Field>

        <Field
          label="Nome fantasia"
          htmlFor="customer-tradeName"
          hint="Como o cliente é chamado no dia a dia."
          className="sm:col-span-2"
        >
          <Input
            id="customer-tradeName"
            value={form.tradeName}
            onChange={(event) => set("tradeName", event.target.value)}
            maxLength={CUSTOMER_LIMITS.tradeNameMaxLength}
          />
        </Field>

        <Field
          label="Tipo de documento"
          htmlFor="customer-documentType"
          error={show("documentType")}
        >
          <Select
            value={form.documentType || "none"}
            onValueChange={(value) =>
              set(
                "documentType",
                value === "none" ? "" : (value as "CPF" | "CNPJ"),
              )
            }
          >
            <SelectTrigger id="customer-documentType" {...described("documentType")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Não informar</SelectItem>
              <SelectItem value="CPF">CPF</SelectItem>
              <SelectItem value="CNPJ">CNPJ</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Número do documento"
          htmlFor="customer-documentNumber"
          error={show("documentNumber")}
        >
          <Input
            id="customer-documentNumber"
            {...described("documentNumber")}
            value={formatBrazilianDocument(form.documentNumber)}
            onChange={(event) => set("documentNumber", event.target.value)}
            inputMode="numeric"
            disabled={!form.documentType}
          />
        </Field>
      </Section>

      <Section title="Contato">
        <Field label="E-mail" htmlFor="customer-email" error={show("email")}>
          <Input
            id="customer-email"
            {...described("email")}
            type="email"
            value={form.email}
            onChange={(event) => set("email", event.target.value)}
            maxLength={320}
          />
        </Field>

        <Field label="Telefone" htmlFor="customer-phone">
          <Input
            id="customer-phone"
            value={form.phone}
            onChange={(event) => set("phone", event.target.value)}
            maxLength={CUSTOMER_LIMITS.phoneMaxLength}
            inputMode="tel"
          />
        </Field>
      </Section>

      <Section title="Endereço">
        {/*
          * Digitado o CEP, logradouro, bairro, cidade e estado chegam sozinhos
          * — e continuam editáveis. Número e complemento não vêm do CEP.
          */}
        <PostalCodeField
          id="customer-address-postalCode"
          value={form.address.postalCode}
          onChange={(value) => setAddress("postalCode", value)}
          onAddressFound={preencherEndereco}
        />

        {ADDRESS_LABELS.map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`customer-address-${key}`}>
            <Input
              id={`customer-address-${key}`}
              value={form.address[key]}
              onChange={(event) => setAddress(key, event.target.value)}
            />
          </Field>
        ))}
      </Section>

      <Section title="Observações">
        <Field label="Observações" htmlFor="customer-notes" className="sm:col-span-2">
          <Textarea
            id="customer-notes"
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
            maxLength={CUSTOMER_LIMITS.notesMaxLength}
            rows={3}
          />
        </Field>
      </Section>

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending
            ? "Salvando…"
            : editing
              ? "Salvar"
              : "Cadastrar cliente"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {/* Obrigatório dito por escrito, não só por cor. */}
        {required ? (
          <span className="text-xs font-normal text-muted-foreground">
            {" "}
            (obrigatório)
          </span>
        ) : null}
      </Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-erro`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-dica`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
