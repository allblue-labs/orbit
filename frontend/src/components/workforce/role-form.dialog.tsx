"use client";

import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useAccessCatalog,
  useCreateRole,
  useUpdateRole,
} from "@/hooks/workforce/use-workforce";
import type { TeamRole } from "@/types/workforce";

export function RoleFormDialog({
  role,
  open,
  onOpenChange,
}: {
  role: TeamRole | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <Body key={role?.id ?? "new"} role={role} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  role,
  onOpenChange,
}: {
  role: TeamRole | null;
  onOpenChange: (open: boolean) => void;
}) {
  const catalog = useAccessCatalog();
  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? "");
  const mutation = role ? update : create;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [permissions, setPermissions] = useState<string[]>(
    role ? [...role.permissions] : [],
  );
  const [surfaces, setSurfaces] = useState<string[]>(
    role ? [...role.allowedSurfaces] : ["WEB"],
  );

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate(
      {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions,
        allowedSurfaces: surfaces,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {role ? "Editar papel" : "Papel personalizado"}
        </DialogTitle>
        <DialogDescription>
          Crie um conjunto reutilizável de acessos. A autorização final também
          respeita organização, unidades e recursos contratados.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="role-name">Nome</Label>
          <Input
            id="role-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ex.: Supervisão regional"
            required
          />
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="role-description">Descrição</Label>
          <Textarea
            id="role-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
          />
        </div>
      </div>

      <fieldset className="space-y-3 rounded-xl border p-4">
        <legend className="px-1 text-sm font-medium">Onde pode acessar</legend>
        <div className="flex flex-wrap gap-5">
          {(catalog.data?.surfaces ?? []).map((surface) => (
            <Label
              key={surface.code}
              htmlFor={`role-surface-${surface.code}`}
              className="flex cursor-pointer items-center gap-2 font-normal"
            >
              <Checkbox
                id={`role-surface-${surface.code}`}
                checked={surfaces.includes(surface.code)}
                onCheckedChange={(checked) =>
                  setSurfaces((current) =>
                    toggle(current, surface.code, checked === true),
                  )
                }
              />
              {surface.label}
            </Label>
          ))}
        </div>
      </fieldset>

      <section>
        <p className="text-sm font-medium">Permissões</p>
        <p className="text-xs text-muted-foreground">
          Selecione apenas o necessário. O servidor impede que um gestor conceda
          acesso que ele próprio não possui.
        </p>
        <Accordion type="multiple" className="mt-2">
          {(catalog.data?.permissionGroups ?? []).map((group) => {
            const count = group.permissions.filter((item) =>
              permissions.includes(item.code),
            ).length;
            return (
              <AccordionItem key={group.key} value={group.key}>
                <AccordionTrigger className="py-3 no-underline hover:no-underline">
                  <span>
                    {group.label}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {count}/{group.permissions.length}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.permissions.map((item) => (
                      <Label
                        key={item.code}
                        htmlFor={`role-permission-${item.code}`}
                        className="flex cursor-pointer items-start gap-2 rounded-md p-2 font-normal hover:bg-muted/50"
                      >
                        <Checkbox
                          id={`role-permission-${item.code}`}
                          checked={permissions.includes(item.code)}
                          onCheckedChange={(checked) =>
                            setPermissions((current) =>
                              toggle(current, item.code, checked === true),
                            )
                          }
                          className="mt-0.5"
                        />
                        {item.label}
                      </Label>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      </section>

      <MutationError error={mutation.error} />
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={
            name.trim().length < 2 ||
            surfaces.length === 0 ||
            mutation.isPending
          }
        >
          {mutation.isPending ? "Salvando…" : role ? "Salvar" : "Criar papel"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function toggle(values: readonly string[], value: string, checked: boolean) {
  return checked
    ? Array.from(new Set([...values, value]))
    : values.filter((item) => item !== value);
}
