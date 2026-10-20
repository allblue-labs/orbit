"use client";

import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { MemberAccessEditor } from "@/components/workforce/member-access-editor";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MEMBER_STATUS_LABELS } from "@/entities";
import { useBusinessUnits } from "@/hooks/organization/use-organization";
import {
  useAccessCatalog,
  useTeamRoles,
  useUpdateMember,
} from "@/hooks/workforce/use-workforce";
import {
  MembershipStatus,
  type TeamMember,
  type UpdateMemberInput,
} from "@/types/workforce";

export function MemberFormDialog({
  member,
  onOpenChange,
}: {
  member: TeamMember | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        {member ? (
          <Body
            key={member.userId}
            member={member}
            onOpenChange={onOpenChange}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  member,
  onOpenChange,
}: {
  member: TeamMember;
  onOpenChange: (open: boolean) => void;
}) {
  const roles = useTeamRoles();
  const units = useBusinessUnits();
  const catalog = useAccessCatalog();
  const update = useUpdateMember(member.userId);

  const [roleId, setRoleId] = useState(member.role.id);
  const [status, setStatus] = useState<string>(member.status);
  const [businessUnitIds, setBusinessUnitIds] = useState<string[]>(
    member.businessUnits.map((unit) => unit.id),
  );
  const [useRoleDefaults, setUseRoleDefaults] = useState(
    member.access.useRoleDefaults,
  );
  const [permissions, setPermissions] = useState<string[]>([
    ...member.access.permissions,
  ]);
  const [allowedSurfaces, setAllowedSurfaces] = useState<string[]>([
    ...member.access.allowedSurfaces,
  ]);

  const role = (roles.data ?? []).find((item) => item.id === roleId);

  const setDefaults = (enabled: boolean) => {
    setUseRoleDefaults(enabled);
    if (!enabled && role) {
      setPermissions([...role.permissions]);
      setAllowedSurfaces([...role.allowedSurfaces]);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const accessChanged =
      useRoleDefaults !== member.access.useRoleDefaults ||
      !sameValues(allowedSurfaces, member.access.allowedSurfaces) ||
      !sameValues(permissions, member.access.permissions);
    const unitsChanged = !sameValues(
      businessUnitIds,
      member.businessUnits.map((unit) => unit.id),
    );

    const input: UpdateMemberInput = {
      roleId: roleId === member.role.id ? undefined : roleId,
      status:
        status === member.status ? undefined : (status as MembershipStatus),
      businessUnitIds: unitsChanged ? businessUnitIds : undefined,
      useRoleDefaults: accessChanged ? useRoleDefaults : undefined,
      permissions: accessChanged && !useRoleDefaults ? permissions : undefined,
      allowedSurfaces:
        accessChanged && !useRoleDefaults ? allowedSurfaces : undefined,
    };

    if (Object.values(input).every((value) => value === undefined)) {
      onOpenChange(false);
      return;
    }

    update.mutate(input, { onSuccess: () => onOpenChange(false) });
  };

  const invalid =
    businessUnitIds.length === 0 ||
    (!useRoleDefaults && allowedSurfaces.length === 0);

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>{member.displayName}</DialogTitle>
        <DialogDescription>
          Altere o papel, as superfícies e o escopo operacional. Nome, e-mail e
          foto continuam pertencendo ao perfil da própria pessoa.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="member-role">Papel</Label>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger id="member-role">
              <SelectValue />
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

        <div className="space-y-2">
          <Label htmlFor="member-status">Situação</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="member-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.values(MembershipStatus).map((value) => (
                <SelectItem key={value} value={value}>
                  {MEMBER_STATUS_LABELS[value] ?? value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <MemberAccessEditor
        units={units.data ?? []}
        selectedUnitIds={businessUnitIds}
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

      <MutationError error={update.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={invalid || update.isPending}>
          {update.isPending ? "Salvando…" : "Salvar acesso"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function sameValues(left: readonly string[], right: readonly string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    left.length === right.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}
