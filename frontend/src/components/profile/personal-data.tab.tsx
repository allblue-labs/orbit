"use client";

/**
 * Dados pessoais.
 *
 * `PATCH /identity/me` aceita seis campos: nome, sobrenome, nome de exibição,
 * telefone, idioma e fuso. O formulário oferece exatamente esses.
 *
 * ## O que não é editável, e por quê
 *
 * - **E-mail** — é a chave de login (`@unique`) e o destino de recuperação de
 *   senha. Trocá-lo é mudar a identidade da conta, e o contrato não o aceita.
 * ## O que mora ao lado
 *
 * **Foto** e **assinatura** são arquivos, não campos de formulário: têm upload
 * próprio, validação de conteúdo e ciclo de vida separado. Ficam em painéis
 * vizinhos nesta mesma aba porque são da pessoa — mas não entram no `PATCH`,
 * que continua aceitando exatamente os seis campos acima.
 */
import { useState } from "react";
import { Mail, ShieldCheck } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PanelError, PanelLoading } from "@/components/panels";
import {
  useProfile,
  useUpdateProfile,
} from "@/hooks/profile/use-profile";
import { formatDateTime, initialsOf } from "@/lib/formatters";
import { PROFILE_LIMITS, type UserProfile } from "@/types/settings";
import { AvatarSection } from "./avatar.section";
import { SignatureSection } from "./signature.section";

export function PersonalDataTab() {
  const query = useProfile();

  if (query.isPending) return <PanelLoading rows={6} />;
  if (query.error || !query.data) {
    return (
      <PanelError error={query.error} onRetry={() => void query.refetch()} />
    );
  }

  return (
    <div className="space-y-6">
      {/*
        Duas colunas: o que se digita à esquerda, quem você é à direita.

        A foto ficava numa faixa abaixo do formulário, e a página pedia rolagem
        para mostrar três blocos que cabem lado a lado. Aqui ela acompanha a
        altura da coluna esquerda inteira — dados em cima, identidade embaixo —,
        que é como a pessoa lê a própria conta: o retrato ao lado do cadastro.

        Em telas estreitas a grade vira uma coluna só e a ordem do DOM vale: o
        formulário primeiro, porque é o que se veio fazer.
      */}
      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Form key={query.data.updatedAt} profile={query.data} />
        <AvatarSection
          initials={initialsOf(query.data.displayName)}
          className="h-full"
        />
      </div>

      <SignatureSection />
    </div>
  );
}

function Form({ profile }: { profile: UserProfile }) {
  const update = useUpdateProfile();

  const [firstName, setFirstName] = useState(profile.firstName ?? "");
  const [lastName, setLastName] = useState(profile.lastName ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    update.mutate({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      displayName: displayName.trim(),
      phone: phone.trim() || undefined,
    });
  };

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-6">
      <section className="glass-panel space-y-4 rounded-xl p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="profile-first-name">Nome</Label>
            <Input
              id="profile-first-name"
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              maxLength={PROFILE_LIMITS.nameMaxLength}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-last-name">Sobrenome</Label>
            <Input
              id="profile-last-name"
              value={lastName}
              onChange={(event) => setLastName(event.target.value)}
              maxLength={PROFILE_LIMITS.nameMaxLength}
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="profile-display-name">Nome de exibição</Label>
            <Input
              id="profile-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={PROFILE_LIMITS.displayNameMaxLength}
            />
            <p className="text-xs text-muted-foreground">
              É como você aparece para o resto da equipe — no topo, nas
              atribuições e nos documentos emitidos.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="profile-phone">Telefone</Label>
            <Input
              id="profile-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              maxLength={PROFILE_LIMITS.phoneMaxLength}
              placeholder="+55 81 90000-0000"
            />
          </div>
        </div>

        <MutationError error={update.error} />

        <div className="flex items-center justify-end gap-3">
          {update.isSuccess ? (
            <span className="text-xs text-muted-foreground">Salvo.</span>
          ) : null}
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border p-5">
        {/*
          * Cada bloco de "Minha conta" é uma seção logo abaixo do título da
          * página, então o nível é `h2`. Eram `h3`, e quem navega por
          * cabeçalhos pulava um degrau que não existia.
          */}
        <h2 className="text-sm font-medium">Identidade da conta</h2>

        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">E-mail</dt>
            <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm">
              <Mail className="size-4 text-muted-foreground" aria-hidden />
              {profile.email}
              {profile.emailVerifiedAt ? (
                <Badge variant="secondary" className="gap-1">
                  <ShieldCheck className="size-3" />
                  verificado
                </Badge>
              ) : (
                <Badge variant="outline">não verificado</Badge>
              )}
            </dd>
          </div>

          <div>
            <dt className="text-xs text-muted-foreground">Conta criada em</dt>
            <dd className="mt-1 text-sm">
              {formatDateTime(profile.createdAt)}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          O e-mail é a chave de login e o destino da recuperação de senha —
          trocá-lo é mudar a identidade da conta, e o contrato não o aceita.
        </p>
      </section>
    </form>
  );
}
