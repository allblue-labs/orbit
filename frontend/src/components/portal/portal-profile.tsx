"use client";

/**
 * O perfil do cliente na web: foto, assinatura, senha, termos e saída.
 */
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Camera, Check, Loader2, LogOut, PenLine, Trash2 } from "lucide-react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { LegalDocumentsPanel } from "@/components/legal/legal-documents-panel";
import {
  SignaturePad,
  type SignaturePadHandle,
} from "@/components/signature/signature-pad";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { browserUrlFor } from "@/lib/backend-url";
import {
  usePortalLogout,
  usePortalProfile,
  usePortalProfileCommand,
  usePortalSession,
} from "@/portal/portal-hooks";
import { PortalChangePassword } from "./portal-change-password";
import { initialsOf, PORTAL_ROUTES } from "./portal-shell";
import { PageTitle } from "./portal-pages";
import { SectionTitle } from "./portal-ui";

export function PortalProfilePage() {
  const router = useRouter();
  const me = usePortalSession().data;
  const perfil = usePortalProfile();
  const comando = usePortalProfileCommand();
  const logout = usePortalLogout();
  const arquivo = useRef<HTMLInputElement | null>(null);
  const [assinando, setAssinando] = useState(false);

  const foto = perfil.data?.avatar.url
    ? browserUrlFor(perfil.data.avatar.url)
    : undefined;
  const assinatura = perfil.data?.signature.url
    ? browserUrlFor(perfil.data.signature.url)
    : undefined;

  return (
    <div className="space-y-8">
      <PageTitle title="Meu perfil" description="Sua foto, assinatura e senha de acesso." />

      <section className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center shadow-sm sm:flex-row sm:text-left">
        <div className="relative">
          <Avatar className="size-20">
            {foto ? <AvatarImage src={foto} alt="" /> : null}
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {initialsOf(me?.identity.displayName)}
            </AvatarFallback>
          </Avatar>
          <button
            type="button"
            aria-label={foto ? "Trocar foto" : "Adicionar foto"}
            title={foto ? "Trocar foto" : "Adicionar foto"}
            onClick={() => arquivo.current?.click()}
            disabled={comando.isPending}
            className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border-2 border-card bg-primary text-primary-foreground"
          >
            {comando.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Camera className="size-4" />
            )}
          </button>
          <input
            ref={arquivo}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic"
            className="hidden"
            onChange={(event) => {
              const escolhido = event.target.files?.[0];
              event.target.value = "";
              if (escolhido) comando.mutate({ kind: "avatar", file: escolhido });
            }}
          />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-lg font-semibold">{me?.identity.displayName}</p>
          <p className="truncate text-sm text-muted-foreground">{me?.identity.email}</p>
          <p className="text-sm text-muted-foreground">
            Cliente de {me?.organization.displayName}
          </p>
        </div>
        {foto ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => comando.mutate({ kind: "remove-avatar" })}
          >
            Remover foto
          </Button>
        ) : null}
      </section>

      <section className="space-y-3">
        <SectionTitle>Assinatura digital</SectionTitle>
        <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
          <div className="flex h-32 items-center justify-center rounded-lg border border-border bg-white p-2">
            {assinatura ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={assinatura} alt="Sua assinatura" className="max-h-full max-w-full object-contain" />
            ) : (
              <span className="flex flex-col items-center gap-1 text-sm text-muted-foreground">
                <PenLine className="size-5" />
                Nenhuma assinatura cadastrada
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {assinatura
              ? "Esta é a assinatura guardada na sua conta. Em breve você poderá usá-la para assinar documentos."
              : "Cadastre sua assinatura para tê-la guardada na conta. Em breve você poderá usá-la para assinar documentos."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setAssinando(true)}>
              <PenLine className="size-4" />
              {assinatura ? "Refazer assinatura" : "Cadastrar assinatura"}
            </Button>
            {assinatura ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => comando.mutate({ kind: "remove-signature" })}
              >
                <Trash2 className="size-4" />
                Remover
              </Button>
            ) : null}
          </div>
          <MutationError error={comando.error} />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>Trocar senha</SectionTitle>
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <PortalChangePassword />
        </div>
      </section>

      <section className="space-y-3">
        <LegalDocumentsPanel />
      </section>

      <Button
        variant="outline"
        className="w-full text-destructive hover:text-destructive sm:w-auto"
        onClick={() =>
          logout.mutate(undefined, {
            onSettled: () => router.replace(PORTAL_ROUTES.login),
          })
        }
      >
        <LogOut className="size-4" />
        Sair da conta
      </Button>

      <SignatureDialog
        open={assinando}
        onClose={() => setAssinando(false)}
        onSave={(png) =>
          comando.mutate(
            { kind: "signature", file: png },
            { onSuccess: () => setAssinando(false) },
          )
        }
        saving={comando.isPending}
      />
    </div>
  );
}

function SignatureDialog({
  open,
  onClose,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (png: Blob) => void;
  saving: boolean;
}) {
  const pad = useRef<SignaturePadHandle | null>(null);
  const [temTraco, setTemTraco] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => !v && !saving && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Sua assinatura</DialogTitle>
          <DialogDescription>
            Assine como assina no papel. Dá para limpar e refazer.
          </DialogDescription>
        </DialogHeader>
        <SignaturePad handleRef={pad} onChange={setTemTraco} disabled={saving} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            disabled={!temTraco || saving}
            onClick={() => pad.current?.limpar()}
          >
            Limpar
          </Button>
          <Button
            disabled={!temTraco || saving}
            onClick={async () => {
              const png = await pad.current?.exportar();
              if (png) onSave(png);
            }}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Salvar assinatura
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
