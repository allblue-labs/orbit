"use client";

/**
 * Segurança da própria conta.
 *
 * Senha, MFA e dispositivos. **Não é autenticação**: login, refresh e logout
 * continuam nas rotas dedicadas com cookies `HttpOnly` que o BFF gerencia.
 * Aqui se administra a conta, não se emite token.
 *
 * ## A sessão atual sobrevive à troca de senha
 *
 * O servidor revoga as demais e mantém a de quem trocou — quem estava com a
 * senha antiga sai, quem acabou de agir não é expulso da tela. Isso é decisão
 * do backend; a tela apenas recarrega a lista de dispositivos depois.
 */
import { useState } from "react";
import { KeyRound, Laptop, ShieldCheck, ShieldOff } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelLoading } from "@/components/panels";
import {
  useChangePassword,
  useDeviceSessions,
  useProfile,
  useRevokeSession,
} from "@/hooks/profile/use-profile";
import { formatDateTime } from "@/lib/formatters";
import { useSession } from "@/providers/session-provider";
import { PROFILE_LIMITS } from "@/types/settings";
import { ListState } from "@/workspace";
import { MfaSection } from "./mfa.section";

export function SecurityTab() {
  const profile = useProfile();
  const sessions = useDeviceSessions();
  const revoke = useRevokeSession();
  const session = useSession();

  return (
    <div className="max-w-3xl space-y-6">
      <PasswordSection />

      {profile.isPending ? (
        <PanelLoading rows={3} />
      ) : profile.data ? (
        <MfaSection enabled={profile.data.mfaEnabled} />
      ) : null}

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <Laptop className="size-4 text-muted-foreground" aria-hidden />
            Dispositivos e sessões
          </h2>
          <p className="text-xs text-muted-foreground">
            Cada sessão é um dispositivo que entrou na conta. Encerrar uma
            sessão desconecta aquele dispositivo imediatamente.
          </p>
        </div>

        <MutationError error={revoke.error} />

        <ListState
          isPending={sessions.isPending}
          error={sessions.error}
          onRetry={() => void sessions.refetch()}
          items={sessions.data ?? []}
          rows={3}
          empty={{
            icon: <Laptop className="size-5" />,
            title: "Nenhuma sessão ativa",
            description: "Nada além desta janela está conectado à conta.",
          }}
        >
          {(rows) => (
            <ul className="glass-panel divide-y divide-border rounded-xl">
              {rows.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {item.client}
                      {item.revokedAt ? (
                        <Badge variant="outline">encerrada</Badge>
                      ) : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.userAgent ?? "Origem não informada"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Entrou em {formatDateTime(item.createdAt)}
                      {item.ipAddress ? ` · ${item.ipAddress}` : ""}
                    </p>
                  </div>

                  {item.revokedAt ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(item.id)}
                    >
                      Encerrar
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ListState>

        <p className="text-xs text-muted-foreground">
          O histórico de acessos ainda não está disponível. O que existe de datado é quando cada dispositivo entrou.
        </p>
      </section>

      {session.requiresPasswordChange ? (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          A plataforma pediu a troca da sua senha. Use o formulário acima.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Troca de senha.
 *
 * `currentPassword` é exigida pelo servidor — é o que separa este fluxo do de
 * recuperação por e-mail, que existe para quem **não** tem a senha atual. A
 * tela não valida a senha; ela a envia e mostra o que o servidor responder.
 */
function PasswordSection() {
  const change = useChangePassword();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmation, setConfirmation] = useState("");

  /**
   * A confirmação é conferida aqui, e só ela.
   *
   * Não é regra de negócio: o backend nem recebe este campo. É proteção contra
   * erro de digitação — a única coisa que o servidor não teria como notar.
   */
  const mismatch = confirmation.length > 0 && next !== confirmation;
  const tooShort =
    next.length > 0 && next.length < PROFILE_LIMITS.passwordMinLength;

  /**
   * O envio espera confirmação.
   *
   * Trocar a senha derruba as outras sessões — o próprio painel abaixo explica
   * isso — e não há como desfazer: a senha antiga deixa de valer no instante
   * em que a nova é aceita. Um clique a mais é barato perto de descobrir o
   * efeito depois.
   */
  const [confirmando, setConfirmando] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setConfirmando(true);
  };

  const trocar = () => {
    setConfirmando(false);
    change.mutate(
      { currentPassword: current, newPassword: next },
      {
        onSuccess: () => {
          setCurrent("");
          setNext("");
          setConfirmation("");
        },
      },
    );
  };

  return (
    <form
      onSubmit={submit}
      className="glass-panel space-y-4 rounded-xl p-5"
    >
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="size-4 text-muted-foreground" aria-hidden />
          Senha
        </h2>
        <p className="text-xs text-muted-foreground">
          Trocar a senha encerra as outras sessões. Esta janela continua
          conectada.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="password-current">Senha atual</Label>
          <Input
            id="password-current"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password-new">Nova senha</Label>
          <Input
            id="password-new"
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            maxLength={PROFILE_LIMITS.passwordMaxLength}
            required
          />
          {tooShort ? (
            <p className="text-xs text-destructive">
              Mínimo de {PROFILE_LIMITS.passwordMinLength} caracteres.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="password-confirm">Confirmar nova senha</Label>
          <Input
            id="password-confirm"
            type="password"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            required
          />
          {mismatch ? (
            <p className="text-xs text-destructive">As senhas não coincidem.</p>
          ) : null}
        </div>
      </div>

      <MutationError error={change.error} />

      <div className="flex items-center justify-end gap-3">
        {change.isSuccess ? (
          <span className="flex items-center gap-1.5 text-xs text-emerald-400">
            <ShieldCheck className="size-3.5" />
            Senha alterada. As outras sessões foram encerradas.
          </span>
        ) : null}
        <Button
          type="submit"
          disabled={
            !current ||
            !next ||
            mismatch ||
            tooShort ||
            change.isPending
          }
        >
          {change.isPending ? "Alterando…" : "Alterar senha"}
        </Button>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldOff className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Esqueceu a senha atual? Saia da conta e use a recuperação por e-mail —
        ela existe justamente para quem não a tem.
      </p>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Alterar sua senha?</AlertDialogTitle>
            <AlertDialogDescription>
              A senha atual deixa de valer imediatamente. As sessões abertas em
              outros dispositivos são encerradas e vão pedir a nova senha — esta
              aqui continua aberta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={trocar}>
              Alterar senha
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
