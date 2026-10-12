"use client";

/**
 * Criação e edição de unidade de negócio.
 *
 * ## Por que existe
 *
 * A seção listava, selecionava e **removia** — sem criar. Quem excluísse a
 * última filial não tinha como recriá-la pela interface, e a operação mais
 * destrutiva era a única disponível.
 *
 * ## Os campos são os do contrato, e só eles
 *
 * `CreateBusinessUnitDto`. `status`, `timezone`, `locale` e `currency`
 * aparecem na leitura e **não** são aceitos na escrita — oferecer um campo
 * para eles renderia `property status should not exist`.
 *
 * `isPrimary` também fica de fora: eleger outra unidade como principal é
 * decisão sobre a organização inteira, não um campo de formulário, e o
 * servidor não define o que acontece com a anterior.
 */
import { useState } from "react";

import { BusinessUnitLogoField } from "./business-unit-logo.field";
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
import {
  useCreateBusinessUnit,
  useUpdateBusinessUnit,
} from "@/hooks/organization/use-organization";
import type { BusinessUnit } from "@/types/organization";

/** Os quatro tipos do contrato, com o nome que se usa em português. */
const UNIT_TYPES = [
  { value: "HEADQUARTERS", label: "Sede" },
  { value: "BRANCH", label: "Filial" },
  { value: "DEPARTMENT", label: "Departamento" },
  { value: "SITE", label: "Site" },
] as const;

export function BusinessUnitFormDialog({
  unit,
  open,
  onOpenChange,
}: {
  /** `null` cria; preenchido edita. */
  unit: BusinessUnit | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {/* `key` remonta o corpo ao trocar de unidade: sem isso o estado
            inicial do formulário anterior sobreviveria à troca. */}
        <Body key={unit?.id ?? "new"} unit={unit} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  unit,
  onOpenChange,
}: {
  unit: BusinessUnit | null;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateBusinessUnit();
  const update = useUpdateBusinessUnit(unit?.id ?? "");
  const mutation = unit ? update : create;

  const [legalName, setLegalName] = useState(unit?.legalName ?? "");
  const [tradeName, setTradeName] = useState(unit?.tradeName ?? "");
  const [type, setType] = useState<string>(unit?.type ?? "BRANCH");
  const [documentType, setDocumentType] = useState<"CPF" | "CNPJ">(
    unit?.documentNumber && unit.documentNumber.replace(/\D/g, "").length === 11
      ? "CPF"
      : "CNPJ",
  );
  const [documentNumber, setDocumentNumber] = useState(
    unit?.documentNumber ?? "",
  );
  const [city, setCity] = useState(unit?.city ?? "");
  const [stateCode, setStateCode] = useState(unit?.stateCode ?? "");
  const [street, setStreet] = useState(unit?.street ?? "");
  const [number, setNumber] = useState(unit?.number ?? "");
  const [postalCode, setPostalCode] = useState(unit?.postalCode ?? "");
  const [email, setEmail] = useState(unit?.email ?? "");
  const [phone, setPhone] = useState(unit?.phone ?? "");
  const [code, setCode] = useState(unit?.code ?? "");

  const opcional = (value: string) => value.trim() || undefined;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      {
        legalName: legalName.trim(),
        tradeName: opcional(tradeName),
        type: type as BusinessUnit["type"],
        documentType,
        documentNumber: documentNumber.replace(/\D/g, ""),
        city: city.trim(),
        street: street.trim(),
        number: opcional(number),
        stateCode: opcional(stateCode)?.toUpperCase(),
        postalCode: opcional(postalCode)?.replace(/\D/g, ""),
        email: opcional(email),
        phone: opcional(phone),
        code: opcional(code),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  /** O servidor exige estes quatro; o botão não promete o que será recusado. */
  const incompleto =
    legalName.trim().length < 2 ||
    documentNumber.replace(/\D/g, "").length < 11 ||
    city.trim().length < 2 ||
    street.trim().length < 2;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {unit ? "Editar organização" : "Nova organização"}
        </DialogTitle>
        <DialogDescription>
          Filiais, sedes e departamentos. A organização entra como filtro de
          contexto nas consultas que o aceitam.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="unit-legal-name">Razão social</Label>
            <Input
              id="unit-legal-name"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              placeholder="Ex.: Clima Engenharia Filial Sul LTDA"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-trade-name">Nome fantasia</Label>
            <Input
              id="unit-trade-name"
              value={tradeName}
              onChange={(event) => setTradeName(event.target.value)}
              placeholder="Ex.: Filial Sul"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-type">Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger id="unit-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNIT_TYPES.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-document-type">Documento</Label>
            <Select
              value={documentType}
              onValueChange={(value) =>
                setDocumentType(value as "CPF" | "CNPJ")
              }
            >
              <SelectTrigger id="unit-document-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CNPJ">CNPJ</SelectItem>
                <SelectItem value="CPF">CPF</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-document-number">Número do documento</Label>
            <Input
              id="unit-document-number"
              value={documentNumber}
              onChange={(event) => setDocumentNumber(event.target.value)}
              inputMode="numeric"
              placeholder={documentType === "CNPJ" ? "00.000.000/0000-00" : "000.000.000-00"}
              required
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="unit-street">Logradouro</Label>
            <Input
              id="unit-street"
              value={street}
              onChange={(event) => setStreet(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-number">Número</Label>
            <Input
              id="unit-number"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-postal-code">CEP</Label>
            <Input
              id="unit-postal-code"
              value={postalCode}
              onChange={(event) => setPostalCode(event.target.value)}
              inputMode="numeric"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-city">Cidade</Label>
            <Input
              id="unit-city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-state">UF</Label>
            <Input
              id="unit-state"
              value={stateCode}
              onChange={(event) => setStateCode(event.target.value)}
              maxLength={2}
              placeholder="PE"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-email">E-mail</Label>
            <Input
              id="unit-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-phone">Telefone</Label>
            <Input
              id="unit-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="unit-code">Código interno</Label>
            <Input
              id="unit-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Opcional — como a organização é chamada nos seus relatórios"
            />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Fuso, moeda e situação não aparecem aqui: são publicados na leitura e
          o contrato de escrita não os aceita.
        </p>
      </div>

      {/* A marca só aparece na edição: enviar imagem exige a unidade já
          criada, e um upload que precisa ser refeito depois de salvar é pior
          que um campo ausente. */}
      {unit ? (
        <div className="border-border border-t pt-4">
          <BusinessUnitLogoField
            unitId={unit.id}
            hasLogo={unit.hasLogo}
            canManage
          />
        </div>
      ) : null}

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incompleto || mutation.isPending}>
          {mutation.isPending
            ? "Salvando…"
            : unit
              ? "Salvar"
              : "Criar organização"}
        </Button>
      </DialogFooter>
    </form>
  );
}
