"use client";

/**
 * Acesso do cliente ao app.
 *
 * O owner cria o login do cliente como cria o de um técnico: escolhe o nome,
 * o domínio é o da organização, e o sistema gera uma senha temporária que
 * aparece **uma vez**. O cliente entra no app, escolhe "Sou cliente" e cria a
 * própria senha no primeiro acesso.
 *
 * O que o cliente vê lá é só dele — equipamentos, atendimentos e documentos —,
 * e só para leitura. Essa garantia é do servidor (identidade separada da
 * equipe, RLS por cliente); este painel só administra a credencial.
 */
import { useState } from "react";
import { Check, Copy, KeyRound, ShieldOff, UserPlus } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { ConfirmDialog } from "@/components/financial/confirm.dialog";
import { PanelFrame } from "@/components/panels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useCreateCustomerPortalAccess,
  useCustomerPortalAccess,
  useDisableCustomerPortalAccess,
  useResetCustomerPortalPassword,
} from "@/hooks/customers/use-customer-portal-access";
import { useDateFormatters } from "@/hooks/use-date-formatters";
import type { CustomerAccessCredentials } from "@/types/customer-portal-access";
import {
  accessEmailPreview,
  accessShareMessage,
  accessStatusText,
} from "./customer-access.model";

export function CustomerAccessPanel({
  customerId,
  customerName,
}: {
  customerId: string;
  customerName: string;
}) {
  const { formatDateTime } = useDateFormatters();
  const access = useCustomerPortalAccess(customerId);
  const create = useCreateCustomerPortalAccess(customerId);
  const reset = useResetCustomerPortalPassword(customerId);
  const disable = useDisableCustomerPortalAccess(customerId);

  const [localPart, setLocalPart] = useState<string | null>(null);
  const [credentials, setCredentials] =
    useState<CustomerAccessCredentials | null>(null);
  const [confirm, setConfirm] = useState<"reset" | "disable" | null>(null);

  const data = access.data;
  const identity = data?.identity ?? null;
  const active = identity?.status === "active";
  const typed =
    localPart ??
    (identity ? identity.email.split("@")[0]! : (data?.suggestedLocalPart ?? ""));
  const preview = accessEmailPreview(typed, data?.domain ?? null);

  return (
    <PanelFrame
      panelId="customer-portal-access"
      title="Acesso do cliente"
      description={`${customerName} acompanha equipamentos, atendimentos e documentos pelo app — só leitura.`}
    >
      {access.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : access.error ? (
        <MutationError error={access.error} />
      ) : credentials ? (
        <CredentialsCard
          credentials={credentials}
          onDone={() => setCredentials(null)}
        />
      ) : active && identity ? (
        <div className="space-y-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{identity.email}</span>
              <Badge variant="secondary">Ativo</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {accessStatusText(identity, formatDateTime)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm("reset")}
            >
              <KeyRound className="size-4" />
              Gerar nova senha
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirm("disable")}
            >
              <ShieldOff className="size-4" />
              Desativar
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate(typed, { onSuccess: setCredentials });
          }}
        >
          {identity?.status === "disabled" ? (
            <p className="text-xs text-muted-foreground">
              O acesso anterior foi desativado. Criar de novo gera uma nova
              senha temporária.
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="customer-access-name">Nome de acesso</Label>
            <div className="flex items-center gap-2">
              <Input
                id="customer-access-name"
                value={typed}
                autoComplete="off"
                onChange={(event) => setLocalPart(event.target.value)}
              />
              {data?.domain ? (
                <span className="shrink-0 font-mono text-sm text-muted-foreground">
                  @{data.domain}
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              {preview
                ? `O cliente entra com ${preview}. O domínio é o da sua empresa, o mesmo da equipe.`
                : "Use letras ou números."}
            </p>
          </div>
          <MutationError error={create.error} />
          <Button
            type="submit"
            size="sm"
            disabled={!preview || create.isPending}
          >
            <UserPlus className="size-4" />
            {create.isPending ? "Criando…" : "Criar acesso"}
          </Button>
        </form>
      )}

      {identity ? (
        <>
          <ConfirmDialog
            open={confirm === "reset"}
            onOpenChange={(open) => !open && setConfirm(null)}
            title="Gerar nova senha?"
            body="A senha atual deixa de valer e o cliente sai do app. Ele entra com a nova senha temporária e cria outra."
            confirmLabel="Gerar nova senha"
            isPending={reset.isPending}
            error={reset.error}
            onConfirm={() =>
              reset.mutate(identity.id, {
                onSuccess: (result) => {
                  setConfirm(null);
                  setCredentials(result);
                },
              })
            }
          />
          <ConfirmDialog
            open={confirm === "disable"}
            onOpenChange={(open) => !open && setConfirm(null)}
            title="Desativar o acesso?"
            body="O cliente sai do app na hora e não entra mais. Você pode criar o acesso de novo depois."
            confirmLabel="Desativar"
            isPending={disable.isPending}
            error={disable.error}
            onConfirm={() =>
              disable.mutate(identity.id, {
                onSuccess: () => {
                  setConfirm(null);
                  setLocalPart(null);
                },
              })
            }
          />
        </>
      ) : null}
    </PanelFrame>
  );
}

/** A senha temporária, uma vez, com o texto pronto para mandar. */
function CredentialsCard({
  credentials,
  onDone,
}: {
  credentials: CustomerAccessCredentials;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(
      accessShareMessage(credentials, `${window.location.origin}/portal`),
    );
    setCopied(true);
  };
  return (
    <div className="space-y-3">
      <dl className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
        <div>
          <dt className="text-xs text-muted-foreground">E-mail</dt>
          <dd className="font-mono text-sm">{credentials.identity.email}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Senha temporária</dt>
          <dd className="font-mono text-lg tracking-wider">
            {credentials.temporaryPassword}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Esta senha aparece só agora. Repasse ao cliente — no primeiro acesso ele
        cria a dele.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void copy()}>
          {copied ? (
            <Check className="size-4" />
          ) : (
            <Copy className="size-4" />
          )}
          {copied ? "Copiado" : "Copiar acesso"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Concluir
        </Button>
      </div>
    </div>
  );
}
