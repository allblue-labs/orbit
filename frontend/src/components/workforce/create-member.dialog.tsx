"use client";

/**
 * Cadastrar alguém da equipe.
 *
 * ## O e-mail aqui é um login, não um endereço
 *
 * Este caminho existe porque o convite pressupõe que a pessoa tem e-mail, lê e-mail
 * e conclui um cadastro sozinha — e boa parte de uma equipe de campo não atende às
 * três. Por isso ele **gera uma senha temporária** em vez de mandar mensagem: nada é
 * enviado para o endereço informado.
 *
 * Então o campo vem montado: a pessoa digita o nome de entrada e o domínio da
 * organização entra sozinho (`joao.silva@clima-norte.com`). Pedir um endereço
 * completo obrigava o owner a inventar um — e ele inventava o Gmail de alguém que
 * não existe, ou repetia o nome no domínio, e no mês seguinte ninguém sabia qual era
 * o login do João.
 *
 * **O owner não passa por aqui.** A conta dele nasce no cadastro da organização, com
 * endereço real, porque é ela que recebe confirmação e recuperação de senha.
 *
 * E quem **vai** receber mensagem — um administrador que acompanha o sistema pelo
 * navegador — tem a saída: "usar outro endereço" devolve o campo livre. O convite,
 * que manda e-mail de verdade, continua exigindo endereço real por natureza.
 */
import { useState, useEffect, useRef } from "react";
import { Check, Copy, KeyRound, UserPlus } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { MemberAccessEditor } from "@/components/workforce/member-access-editor";
import { Badge } from "@/components/ui/badge";
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
import { useBusinessUnits } from "@/hooks/organization/use-organization";
import {
  useAccessCatalog,
  useCreateTeamMember,
  useTeamRoles,
} from "@/hooks/workforce/use-workforce";
import { useSession } from "@/providers/session-provider";
import type { CreatedTeamMember } from "@/types/workforce";
import {
  composeEmail,
  localPartOf,
  looksLikeEmail,
  organizationDomain,
  suggestLocalPart,
} from "./member-email";

const STEPS = ["Dados", "Papel", "Acessos", "Revisão"] as const;

export function CreateMemberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <Body onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const create = useCreateTeamMember();
  const roles = useTeamRoles();
  const units = useBusinessUnits();
  const catalog = useAccessCatalog();

  const session = useSession();

  /**
   * O domínio da organização, ou `null` quando o slug não serve como domínio.
   *
   * Sem ele o campo volta a pedir o endereço inteiro: montar `@.com` produziria um
   * login que o servidor recusa, depois de o owner preencher o resto do cadastro.
   */
  const domain = organizationDomain(session.organization?.slug);

  const [step, setStep] = useState(0);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  /**
   * O nome de entrada, sem o domínio.
   *
   * `null` significa "ainda não foi tocado": aí a sugestão vem do nome da pessoa, e
   * é por isso que digitar o nome preenche o login sozinho. Depois de editado, o que
   * a pessoa escreveu manda — inclusive se ela apagar tudo.
   */
  const [localPart, setLocalPart] = useState<string | null>(null);

  /** Endereço livre: para quem vai receber mensagem de verdade. */
  const [customEmail, setCustomEmail] = useState("");
  const [useOrgDomain, setUseOrgDomain] = useState(true);
  const [roleId, setRoleId] = useState("");
  const [businessUnitIds, setBusinessUnitIds] = useState<string[] | null>(null);
  const [useRoleDefaults, setUseRoleDefaults] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [allowedSurfaces, setAllowedSurfaces] = useState<string[]>([]);
  const [created, setCreated] = useState<CreatedTeamMember | null>(null);

  const role = (roles.data ?? []).find((item) => item.id === roleId);
  const primaryUnit =
    units.data?.find((unit) => unit.isPrimary) ?? units.data?.[0];
  const selectedBusinessUnitIds =
    businessUnitIds ?? (primaryUnit ? [primaryUnit.id] : []);

  const selectRole = (value: string) => {
    setRoleId(value);
    const selected = (roles.data ?? []).find((item) => item.id === value);
    if (!selected) return;
    setPermissions([...selected.permissions]);
    setAllowedSurfaces([...selected.allowedSurfaces]);
  };

  const setDefaults = (enabled: boolean) => {
    setUseRoleDefaults(enabled);
    if (!enabled && role) {
      setPermissions([...role.permissions]);
      setAllowedSurfaces([...role.allowedSurfaces]);
    }
  };

  /* O nome de entrada exibido: o que foi digitado, ou a sugestão do nome. */
  const localPartValue = localPart ?? suggestLocalPart(firstName, lastName);

  /* Um só endereço sai daqui, e as duas formas de montá-lo convergem nele: o resto
     do formulário não sabe qual foi usada. */
  /* String vazia quando ainda não dá para montar: o resto do formulário trata
     "sem endereço" do mesmo jeito nas duas formas, sem carregar um `null` que
     cada leitor tem de lembrar de conferir. */
  const email =
    (useOrgDomain && domain
      ? composeEmail(localPartValue, domain)
      : customEmail.trim()) ?? "";

  const dataValid =
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    looksLikeEmail(email);
  const accessValid =
    selectedBusinessUnitIds.length > 0 &&
    (useRoleDefaults
      ? Boolean(role?.allowedSurfaces.length)
      : allowedSurfaces.length > 0);
  const canContinue =
    (step === 0 && dataValid) ||
    (step === 1 && Boolean(roleId)) ||
    (step === 2 && accessValid) ||
    step === 3;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (step < STEPS.length - 1) {
      if (canContinue) setStep((current) => current + 1);
      return;
    }

    create.mutate(
      {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        roleId,
        businessUnitIds: selectedBusinessUnitIds,
        useRoleDefaults,
        ...(useRoleDefaults ? {} : { permissions, allowedSurfaces }),
      },
      { onSuccess: setCreated },
    );
  };

  if (created) {
    return (
      <GeneratedPassword result={created} onClose={() => onOpenChange(false)} />
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>Cadastrar usuário</DialogTitle>
        <DialogDescription>
          Defina identidade, papel, superfícies e unidades antes de liberar o
          primeiro acesso.
        </DialogDescription>
      </DialogHeader>

      <ol className="grid grid-cols-4 gap-2" aria-label="Etapas do cadastro">
        {STEPS.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              className="w-full text-left"
              onClick={() => index < step && setStep(index)}
              disabled={index > step}
            >
              <span
                className={`block h-1.5 rounded-full ${index <= step ? "bg-primary" : "bg-muted"}`}
              />
              <span className="mt-1 block text-xs text-muted-foreground">
                {index + 1}. {label}
              </span>
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="member-first-name">Nome</Label>
            <Input
              id="member-first-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="member-last-name">Sobrenome</Label>
            <Input
              id="member-last-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="member-email">
              {useOrgDomain && domain ? "Nome de entrada" : "E-mail"}
            </Label>

            {useOrgDomain && domain ? (
              <>
                <OrgDomainInput
                  localPart={localPartValue}
                  domain={domain}
                  onChange={setLocalPart}
                />
                {/*
                  O endereço final, quando o que foi digitado não é o que sai.

                  O campo mostra o texto cru enquanto se digita — corrigir letra por
                  letra brigaria com o cursor. Então "José Antônio" aparece no campo
                  e `jose.antonio@…` é o login de verdade, e quem cadastra precisa
                  ver isso antes do passo de revisão.
                */}
                {email && email !== `${localPartValue}@${domain}` ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Login: </span>
                    <span className="font-mono">{email}</span>
                  </p>
                ) : null}
                <p className="text-muted-foreground text-xs">
                  É o login da pessoa, não um endereço que recebe mensagem: o acesso
                  sai numa senha temporária, aqui mesmo.{" "}
                  <button
                    type="button"
                    className="text-foreground underline underline-offset-2"
                    onClick={() => {
                      setUseOrgDomain(false);
                      /* O que já estava montado vira o ponto de partida do campo
                         livre: trocar de forma não pode apagar o que foi digitado. */
                      setCustomEmail(email);
                    }}
                  >
                    Usar outro endereço
                  </button>{" "}
                  — para quem vai receber mensagem de verdade.
                </p>
              </>
            ) : (
              <>
                <Input
                  id="member-email"
                  type="email"
                  value={customEmail}
                  onChange={(event) => setCustomEmail(event.target.value)}
                  placeholder="nome@empresa.com.br"
                  required
                />
                {domain ? (
                  <p className="text-muted-foreground text-xs">
                    <button
                      type="button"
                      className="text-foreground underline underline-offset-2"
                      onClick={() => setUseOrgDomain(true)}
                    >
                      Voltar para @{domain}
                    </button>{" "}
                    — o formato padrão de quem entra pelo aplicativo.
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="member-role">Papel</Label>
            <Select value={roleId} onValueChange={selectRole}>
              <SelectTrigger id="member-role">
                <SelectValue placeholder="Escolher papel" />
              </SelectTrigger>
              <SelectContent>
                {(roles.data ?? []).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {role ? (
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="font-medium">{role.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {role.description ?? "Papel operacional da organização."}
              </p>
              <div className="mt-3 flex gap-2">
                {["MOBILE", "WEB"].map((surface) => (
                  <Badge
                    key={surface}
                    variant={
                      role.allowedSurfaces.includes(surface)
                        ? "secondary"
                        : "outline"
                    }
                    className={
                      role.allowedSurfaces.includes(surface)
                        ? undefined
                        : "opacity-45"
                    }
                  >
                    {surface === "MOBILE" ? "App mobile" : "Plataforma Web"}{" "}
                    {role.allowedSurfaces.includes(surface) ? "✓" : "—"}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {step === 2 ? (
        <MemberAccessEditor
          units={units.data ?? []}
          selectedUnitIds={selectedBusinessUnitIds}
          onSelectedUnitIdsChange={setBusinessUnitIds}
          role={role}
          catalog={catalog.data}
          useRoleDefaults={useRoleDefaults}
          onUseRoleDefaultsChange={setDefaults}
          permissions={permissions}
          onPermissionsChange={setPermissions}
          allowedSurfaces={allowedSurfaces}
          onAllowedSurfacesChange={setAllowedSurfaces}
        />
      ) : null}

      {step === 3 ? (
        <div className="space-y-4 rounded-xl border p-4">
          <div>
            <p className="text-xs text-muted-foreground">Pessoa</p>
            <p className="font-medium">
              {firstName.trim()} {lastName.trim()}
            </p>
            <p className="text-sm text-muted-foreground">{email.trim()}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Summary label="Papel" value={role?.name ?? "—"} />
            <Summary
              label="Unidades"
              value={`${selectedBusinessUnitIds.length} selecionada${selectedBusinessUnitIds.length === 1 ? "" : "s"}`}
            />
            <Summary
              label="Superfícies"
              value={
                (useRoleDefaults
                  ? role?.allowedSurfaces
                  : allowedSurfaces
                )?.join(" · ") ?? "—"
              }
            />
            <Summary
              label="Permissões"
              value={
                useRoleDefaults
                  ? "Recomendadas pelo papel"
                  : `${permissions.length} selecionadas`
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            A pessoa receberá uma senha temporária exibida uma única vez.
          </p>
        </div>
      ) : null}

      <MutationError error={create.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() =>
            step === 0 ? onOpenChange(false) : setStep((value) => value - 1)
          }
        >
          {step === 0 ? "Cancelar" : "Voltar"}
        </Button>
        <Button type="submit" disabled={!canContinue || create.isPending}>
          {step === 3 ? <UserPlus className="size-4" /> : null}
          {create.isPending
            ? "Cadastrando…"
            : step === 3
              ? "Cadastrar"
              : "Continuar"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

function GeneratedPassword({
  result,
  onClose,
}: {
  result: CreatedTeamMember;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.temporaryPassword);
      setCopied(true);
    } catch {
      // The value remains visible when clipboard access is unavailable.
    }
  };

  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle>{result.member.displayName} cadastrado</DialogTitle>
        <DialogDescription>
          Esta senha aparece <strong>uma única vez</strong>. Guarde-a agora e
          repasse para a pessoa.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="rounded-lg border bg-muted/40 p-4">
          <p className="text-xs text-muted-foreground">Senha temporária</p>
          <p
            className="mt-1 font-mono text-2xl font-semibold tracking-wider"
            data-testid="temporary-password"
          >
            {result.temporaryPassword}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={copy}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copiada" : "Copiar senha"}
        </Button>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            {result.member.email} troca esta senha no primeiro acesso. Se ela
            for perdida, gere um novo link nas ações da pessoa.
          </span>
        </p>
      </div>
      <DialogFooter>
        <Button type="button" onClick={onClose}>
          Concluir
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * O campo de login com o domínio da organização **dentro** dele.
 *
 * ## Por que dentro
 *
 * O domínio ficava ao lado, numa caixa cinza colada à borda do campo. Lia-se
 * como um rótulo desbotado grudado ali, e não como parte do endereço que está
 * sendo escrito. Dentro, o campo mostra desde a primeira tecla o endereço
 * inteiro — que é o que a pessoa vai usar para entrar.
 *
 * ## E continua não sendo editável
 *
 * Era essa a razão de deixá-lo fora: dentro ele seria apagável, e apagado
 * produz um login inválido que só falha no envio. A proteção mudou de lugar —
 * o que vier depois do primeiro `@` é descartado a cada tecla, e o cursor é
 * devolvido para antes dele. Tentar editar o domínio simplesmente não pega.
 */
function OrgDomainInput({
  localPart,
  domain,
  onChange,
}: {
  localPart: string;
  domain: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const composto = `${localPart}@${domain}`;

  /**
   * O cursor volta para antes do `@` depois de cada tecla.
   *
   * Sem isto, digitar leva o cursor para o fim — depois do domínio — e a letra
   * seguinte entraria no meio dele, só para ser descartada. O campo pareceria
   * engolir o que se digita.
   */
  useEffect(() => {
    const campo = ref.current;
    if (!campo || document.activeElement !== campo) return;
    campo.setSelectionRange(localPart.length, localPart.length);
  }, [localPart]);

  return (
    <Input
      id="member-email"
      ref={ref}
      value={composto}
      onChange={(event) => onChange(localPartOf(event.target.value))}
      /* O clique em qualquer ponto cai antes do `@`: o domínio não é um lugar
         onde faça sentido deixar o cursor. */
      onFocus={() =>
        ref.current?.setSelectionRange(localPart.length, localPart.length)
      }
      className="font-mono"
      /* Marcado porque o teste de navegador precisa compor o mesmo endereço
         que a tela compõe: o domínio vem da organização. */
      data-testid="member-email-domain"
      data-domain={domain}
      required
    />
  );
}
