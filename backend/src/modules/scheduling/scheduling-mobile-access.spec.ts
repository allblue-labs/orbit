import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../../common/authorization.service';
import { PermissionGuard, SurfaceGuard } from '../../guards/foundation.guards';
import {
  ASSIGNABLE_TEAM_ROLES,
  ASSISTANT_TECHNICIAN_ROLE_KEY,
  FIELD_TECHNICIAN_ROLE_KEY,
} from '../organizations/team-roles';
import {
  ACTIVE_PLAN_KEY,
  REQUIRED_CAPABILITIES_KEY,
} from '../subscription-plans/plan-access';
import { SchedulingController } from './scheduling.controller';

describe('Agenda com o acesso real dos perfis de campo', () => {
  const reflector = new Reflector();
  const surfaces = new SurfaceGuard(reflector);
  const permissions = new PermissionGuard(
    reflector,
    new AuthorizationService(),
  );

  function context(
    roleKey: string,
    handler: keyof SchedulingController = 'agenda',
    grantedPermissions?: readonly string[],
  ) {
    const role = ASSIGNABLE_TEAM_ROLES.find((item) => item.key === roleKey)!;
    return {
      // Metadata is attached to the original function; never invoke it here.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      getHandler: () => SchedulingController.prototype[handler],
      getClass: () => SchedulingController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 'technician',
            isOrganizationOwner: false,
            roles: [role.key],
            permissions: grantedPermissions ?? role.permissions,
            allowedSurfaces: role.allowedSurfaces,
            businessUnitIds: ['unit-1'],
          },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it.each([FIELD_TECHNICIAN_ROLE_KEY, ASSISTANT_TECHNICIAN_ROLE_KEY])(
    '%s consulta a agenda com acesso exclusivamente MOBILE',
    (roleKey) => {
      const request = context(roleKey);
      expect(surfaces.canActivate(request)).toBe(true);
      expect(permissions.canActivate(request)).toBe(true);
    },
  );

  it('continua exigindo a permissão efetiva do membro', () => {
    const request = context(FIELD_TECHNICIAN_ROLE_KEY, 'agenda', []);
    expect(surfaces.canActivate(request)).toBe(true);
    expect(() => permissions.canActivate(request)).toThrow(
      'Missing required permission',
    );
  });

  it('não abre as rotas de gestão ao perfil MOBILE', () => {
    for (const method of [
      'createEvent',
      'createCalendar',
      'removeEvent',
    ] as const) {
      expect(() =>
        surfaces.canActivate(context(FIELD_TECHNICIAN_ROLE_KEY, method)),
      ).toThrow('Client surface is not allowed');
    }
  });

  it('preserva a validação do plano e da capability na consulta', () => {
    const request = context(FIELD_TECHNICIAN_ROLE_KEY);
    const targets = [request.getHandler(), request.getClass()];
    expect(reflector.getAllAndOverride(ACTIVE_PLAN_KEY, targets)).toBe(true);
    expect(
      reflector.getAllAndOverride(REQUIRED_CAPABILITIES_KEY, targets),
    ).toEqual(['scheduling.read']);
  });
});
