"use client";

/**
 * Cadastro e edição de certificação.
 *
 * ## Um formulário, dois lugares
 *
 * A certificação aparece no detalhe da pessoa e na aba da organização. As duas
 * telas escrevem no mesmo contrato, com os mesmos quatro campos — dois
 * formulários divergiriam no primeiro campo novo, e o de baixo uso divergiria
 * calado.
 *
 * ## De quem é a certificação
 *
 * `POST /workforce/members/:userId/certifications` exige a pessoa; o `PATCH`
 * é em `/certifications/:id` e **não a aceita**. Então: ao criar a partir da
 * organização, a pessoa é escolhida aqui; ao criar de dentro de um membro, já
 * vem decidida; ao editar, a pessoa é mostrada e não se troca — mudar de dono
 * seria apagar e cadastrar de novo, e o servidor não oferece isso.
 *
 * ## O vencimento é do servidor
 *
 * `expiryStatus` e `daysUntilExpiry` vêm calculados pelo backend, com o mesmo
 * relógio para todos. Este formulário só informa a data — habilitação não pode
 * depender do relógio de quem digita.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { UserReference } from "@/components/identity/user-reference";
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
  useCreateCertification,
  useTeamMembers,
  useUpdateCertification,
} from "@/hooks/workforce/use-workforce";
import type { MemberCertification } from "@/types/workforce";

/** `<input type="date">` só aceita `aaaa-mm-dd`; o servidor manda ISO. */
function paraCampoDeData(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : "";
}

export function CertificationFormDialog({
  certification,
  userId,
  open,
  onOpenChange,
}: {
  /** `null` cadastra; uma certificação edita. */
  certification: MemberCertification | null;
  /** Definido quando o formulário abre dentro de uma pessoa. */
  userId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/*
         * O corpo é remontado a cada abertura, e trocado quando muda de
         * certificação: o estado dos campos nasce das props e morre com o
         * diálogo. Semear com `useEffect` deixaria a segunda edição abrir com
         * os valores da primeira sempre que a dependência escapasse.
         */}
        <Body
          key={certification?.id ?? "new"}
          certification={certification}
          fixedUserId={userId}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  certification,
  fixedUserId,
  onOpenChange,
}: {
  certification: MemberCertification | null;
  fixedUserId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const editando = certification !== null;

  const [userId, setUserId] = useState(
    certification?.userId ?? fixedUserId ?? "",
  );
  const [name, setName] = useState(certification?.name ?? "");
  const [issuer, setIssuer] = useState(certification?.issuer ?? "");
  const [credentialId, setCredentialId] = useState(
    certification?.credentialId ?? "",
  );
  const [expiresAt, setExpiresAt] = useState(
    paraCampoDeData(certification?.expiresAt),
  );

  /* A escolha de pessoa só é carregada quando é ela que falta. */
  const members = useTeamMembers(
    !editando && !fixedUserId ? { page: 1, limit: 100 } : undefined,
  );

  const create = useCreateCertification(userId);
  const update = useUpdateCertification(certification?.id ?? "");
  const mutation = editando ? update : create;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      {
        name: name.trim(),
        issuer: issuer.trim() || undefined,
        credentialId: credentialId.trim() || undefined,
        expiresAt: expiresAt || undefined,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const pronto = Boolean(name.trim()) && Boolean(userId);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editando ? "Editar certificação" : "Nova certificação"}
        </DialogTitle>
        <DialogDescription>
          A situação do prazo é calculada pelo servidor a partir da validade.
        </DialogDescription>
      </DialogHeader>

      <form onSubmit={submit} className="space-y-4">
        {editando || fixedUserId ? (
          <div className="space-y-1.5">
            <Label>Pessoa</Label>
            <p className="text-sm">
              <UserReference userId={userId} />
            </p>
            {editando ? (
              <p className="text-xs text-muted-foreground">
                A certificação pertence a esta pessoa. Para transferi-la,
                cadastre na outra e remova aqui.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="certification-user">Pessoa</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger id="certification-user">
                <SelectValue placeholder="Escolha quem tem a certificação" />
              </SelectTrigger>
              <SelectContent>
                {(members.data?.data ?? []).map((member) => (
                  <SelectItem key={member.userId} value={member.userId}>
                    {member.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="certification-name">Certificação</Label>
          <Input
            id="certification-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: NR-35 Trabalho em Altura"
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="certification-issuer">Emissor</Label>
            <Input
              id="certification-issuer"
              value={issuer}
              onChange={(event) => setIssuer(event.target.value)}
              placeholder="Ex.: SENAI"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="certification-credential">Registro</Label>
            <Input
              id="certification-credential"
              value={credentialId}
              onChange={(event) => setCredentialId(event.target.value)}
              placeholder="Número do certificado"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="certification-expires">Válida até</Label>
            <Input
              id="certification-expires"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Em branco, a certificação é tratada como sem prazo.
            </p>
          </div>
        </div>

        <MutationError error={mutation.error} />

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={!pronto || mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
