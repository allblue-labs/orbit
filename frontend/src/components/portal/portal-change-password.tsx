"use client";

/**
 * Trocar a senha — obrigatória no primeiro acesso, opcional no perfil.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useChangePortalPassword, usePortalLogout } from "@/portal/portal-hooks";
import type { PortalMe } from "@/portal/portal-types";

export function PortalChangePassword({
  required = false,
  me,
  onDone,
}: {
  required?: boolean;
  me?: PortalMe;
  onDone?: () => void;
}) {
  const router = useRouter();
  const change = useChangePortalPassword();
  const logout = usePortalLogout();
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const salvar = (event: React.FormEvent) => {
    event.preventDefault();
    if (nova.length < 12) return setAviso("Use no mínimo 12 caracteres.");
    if (nova === atual) return setAviso("A nova senha precisa ser diferente da atual.");
    if (nova !== confirmacao) return setAviso("As senhas não conferem.");
    setAviso(null);
    change.mutate(
      { currentPassword: atual, newPassword: nova },
      {
        onSuccess: () => {
          setAtual("");
          setNova("");
          setConfirmacao("");
          onDone?.();
        },
      },
    );
  };

  const formulario = (
    <form className="space-y-4" onSubmit={salvar}>
      <div className="space-y-1.5">
        <Label htmlFor="portal-pw-atual">
          {required ? "Senha temporária" : "Senha atual"}
        </Label>
        <Input
          id="portal-pw-atual"
          type="password"
          autoComplete="current-password"
          value={atual}
          onChange={(e) => setAtual(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="portal-pw-nova">Nova senha</Label>
        <Input
          id="portal-pw-nova"
          type="password"
          autoComplete="new-password"
          value={nova}
          onChange={(e) => setNova(e.target.value)}
          required
        />
        <p className="text-xs text-muted-foreground">No mínimo 12 caracteres.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="portal-pw-confirma">Confirme a nova senha</Label>
        <Input
          id="portal-pw-confirma"
          type="password"
          autoComplete="new-password"
          value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)}
          required
        />
      </div>
      {aviso ? <p className="text-sm text-destructive">{aviso}</p> : null}
      <MutationError error={change.error} />
      {change.isSuccess && !required ? (
        <p className="text-sm text-emerald-700">Senha trocada.</p>
      ) : null}
      <Button type="submit" disabled={change.isPending} className="w-full sm:w-auto">
        {change.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
        Salvar senha
      </Button>
    </form>
  );

  if (!required) return formulario;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <OrbitLogo className="h-7 w-auto self-start" />
      <div className="space-y-5 rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Crie sua senha</h1>
          <p className="text-sm text-muted-foreground">
            Você entrou com a senha temporária que{" "}
            {me?.organization.displayName ?? "a empresa"} passou. Crie agora a
            sua — só você vai saber qual é.
          </p>
        </div>
        {formulario}
      </div>
      <button
        type="button"
        className="text-sm text-muted-foreground hover:text-foreground"
        onClick={() =>
          logout.mutate(undefined, {
            onSettled: () => router.replace("/portal/entrar"),
          })
        }
      >
        Sair
      </button>
    </main>
  );
}
