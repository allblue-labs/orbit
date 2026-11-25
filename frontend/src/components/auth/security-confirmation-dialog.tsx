"use client";

import { useId, useState } from "react";
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
import { MutationError } from "@/components/artifact-studio/mutation-error";
import type { SecurityCredentials } from "@/lib/biometrics/security-confirmation";

export function SecurityConfirmationDialog({
  title,
  askForMfa,
  onConfirm,
  onClose,
}: {
  title: string;
  askForMfa: boolean;
  onConfirm: (credentials: SecurityCredentials) => Promise<boolean>;
  onClose: () => void;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Confirme sua identidade para continuar.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!password || busy) return;
            setBusy(true);
            setError(null);
            const credentials = {
              currentPassword: password,
              ...(code.trim() ? { mfaCode: code.trim() } : {}),
            };
            setPassword("");
            setCode("");
            try {
              if (await onConfirm(credentials)) onClose();
            } catch (error) {
              setError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-password`}>Senha atual</Label>
            <Input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {askForMfa && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-code`}>
                Código do autenticador, se configurado
              </Label>
              <Input
                id={`${id}-code`}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
          )}
          {error != null && <MutationError error={error} />}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !password}>
              {busy ? "Confirmando…" : "Confirmar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
