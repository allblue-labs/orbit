"use client";

import { ShieldCheck } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { AccessCatalog, TeamRole } from "@/types/workforce";

interface UnitOption {
  id: string;
  legalName: string;
  tradeName: string | null;
}

interface MemberAccessEditorProps {
  units: readonly UnitOption[];
  selectedUnitIds: readonly string[];
  onSelectedUnitIdsChange: (ids: string[]) => void;
  role: TeamRole | undefined;
  catalog: AccessCatalog | undefined;
  useRoleDefaults: boolean;
  onUseRoleDefaultsChange: (value: boolean) => void;
  permissions: readonly string[];
  onPermissionsChange: (permissions: string[]) => void;
  allowedSurfaces: readonly string[];
  onAllowedSurfacesChange: (surfaces: string[]) => void;
}

const toggle = (
  current: readonly string[],
  value: string,
  checked: boolean,
): string[] =>
  checked
    ? Array.from(new Set([...current, value]))
    : current.filter((item) => item !== value);

/**
 * Editor único para escopo e acesso. Ele apenas coleta intenção: a authority
 * continua no backend, que valida catálogo, delegação e unidade por unidade.
 */
export function MemberAccessEditor({
  units,
  selectedUnitIds,
  onSelectedUnitIdsChange,
  role,
  catalog,
  useRoleDefaults,
  onUseRoleDefaultsChange,
  permissions,
  onPermissionsChange,
  allowedSurfaces,
  onAllowedSurfacesChange,
}: MemberAccessEditorProps) {
  const effectivePermissions = useRoleDefaults
    ? (role?.permissions ?? [])
    : permissions;
  const effectiveSurfaces = useRoleDefaults
    ? (role?.allowedSurfaces ?? [])
    : allowedSurfaces;

  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby="member-units-title">
        <div>
          <p id="member-units-title" className="text-sm font-medium">
            Unidades de atuação
          </p>
          <p className="text-xs text-muted-foreground">
            Selecione uma ou mais unidades. O servidor impede acesso fora do
            seu próprio escopo.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {units.map((unit) => {
            const checked = selectedUnitIds.includes(unit.id);
            const id = `member-unit-${unit.id}`;
            return (
              <Label
                key={unit.id}
                htmlFor={id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal"
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  onCheckedChange={(value) =>
                    onSelectedUnitIdsChange(
                      toggle(selectedUnitIds, unit.id, value === true),
                    )
                  }
                />
                <span className="min-w-0 truncate">
                  {unit.tradeName ?? unit.legalName}
                </span>
              </Label>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border bg-muted/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="member-role-defaults" className="font-medium">
              Usar permissões recomendadas
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Mantém superfícies e permissões sincronizadas com o papel.
            </p>
          </div>
          <Switch
            id="member-role-defaults"
            checked={useRoleDefaults}
            onCheckedChange={onUseRoleDefaultsChange}
          />
        </div>

        {useRoleDefaults ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {effectiveSurfaces.map((surface) => (
              <Badge key={surface} variant="secondary">
                {surfaceLabel(surface, catalog)}
              </Badge>
            ))}
            <Badge variant="outline">
              <ShieldCheck className="mr-1 size-3" />
              {effectivePermissions.length} permissões do papel
            </Badge>
          </div>
        ) : (
          <div className="mt-5 space-y-5">
            <div className="space-y-2">
              <p className="text-sm font-medium">Onde pode acessar</p>
              <div className="flex flex-wrap gap-4">
                {(catalog?.surfaces ?? []).map((surface) => (
                  <Label
                    key={surface.code}
                    htmlFor={`member-surface-${surface.code}`}
                    className="flex cursor-pointer items-center gap-2 font-normal"
                  >
                    <Checkbox
                      id={`member-surface-${surface.code}`}
                      checked={allowedSurfaces.includes(surface.code)}
                      onCheckedChange={(value) =>
                        onAllowedSurfacesChange(
                          toggle(
                            allowedSurfaces,
                            surface.code,
                            value === true,
                          ),
                        )
                      }
                    />
                    {surface.label}
                  </Label>
                ))}
              </div>
            </div>

            <div>
              <p className="text-sm font-medium">Permissões específicas</p>
              <p className="text-xs text-muted-foreground">
                Personalizações nunca podem ultrapassar o acesso de quem está
                concedendo.
              </p>
              <Accordion type="multiple" className="mt-2">
                {(catalog?.permissionGroups ?? []).map((group) => {
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
                              htmlFor={`member-permission-${item.code}`}
                              className="flex cursor-pointer items-start gap-2 rounded-md p-2 font-normal hover:bg-muted/50"
                            >
                              <Checkbox
                                id={`member-permission-${item.code}`}
                                className="mt-0.5"
                                checked={permissions.includes(item.code)}
                                onCheckedChange={(value) =>
                                  onPermissionsChange(
                                    toggle(
                                      permissions,
                                      item.code,
                                      value === true,
                                    ),
                                  )
                                }
                              />
                              <span>{item.label}</span>
                            </Label>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function surfaceLabel(surface: string, catalog: AccessCatalog | undefined) {
  return (
    catalog?.surfaces.find((item) => item.code === surface)?.label ?? surface
  );
}
