import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../../../../common/authorization.service';
import {
  PermissionGuard,
  SurfaceGuard,
} from '../../../../guards/foundation.guards';
import type { IdentityRequest } from '../../../identity/infrastructure/jwt-authentication.guard';
import {
  ASSIGNABLE_TEAM_ROLES,
  ASSISTANT_TECHNICIAN_ROLE_KEY,
  FIELD_TECHNICIAN_ROLE_KEY,
} from '../../team-roles';
import {
  ACTIVE_PLAN_KEY,
  REQUIRED_CAPABILITIES_KEY,
} from '../../../subscription-plans/plan-access';
import { AssetController } from './asset.controller';
import { EquipmentQrService } from './equipment-qr.service';

describe('Leitura de equipamentos por QR no aplicativo de campo', () => {
  const reflector = new Reflector();
  const surfaces = new SurfaceGuard(reflector);
  const permissions = new PermissionGuard(
    reflector,
    new AuthorizationService(),
  );

  function setup(roleKey: string, unitId = 'unit-1') {
    const role = ASSIGNABLE_TEAM_ROLES.find((item) => item.key === roleKey)!;
    const identity = {
      id: 'operator',
      organizationId: 'org-1',
      businessUnitIds: [unitId],
      roles: [role.key],
      permissions: role.permissions,
      allowedSurfaces: role.allowedSurfaces,
      isOrganizationOwner: false,
    };
    const request = { identity, user: identity } as unknown as IdentityRequest;
    const context = (handler: keyof AssetController = 'resolveQr') =>
      ({
        // The reflector needs the original handler; the function isn't invoked.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        getHandler: () => AssetController.prototype[handler],
        getClass: () => AssetController,
        switchToHttp: () => ({ getRequest: () => request }),
      }) as unknown as ExecutionContext;
    const repository = {
      hash: jest.fn((token: string) => token),
      identityByTokenHash: jest.fn((token: string, organizationId: string) => {
        if (
          organizationId !== 'org-1' ||
          !['a'.repeat(43), 'b'.repeat(43)].includes(token)
        )
          return Promise.resolve(null);
        const customer = token[0];
        return Promise.resolve({
          businessUnitId: 'unit-1',
          equipment: {
            id: `equipment-${customer}`,
            businessUnitId: 'unit-1',
            customerId: `customer-${customer}`,
            name: `Equipamento ${customer}`,
            status: 'ACTIVE',
            identifier: `EQ-${customer}`,
            category: 'EQUIPMENT',
            manufacturer: 'Marca',
            model: 'Modelo',
            serialNumber: '123',
            location: 'Sala',
            specifications: {},
            customer: {
              id: `customer-${customer}`,
              legalName: `Cliente ${customer}`,
              tradeName: null,
              contacts: [],
            },
          },
        });
      }),
      fieldContext: jest.fn().mockResolvedValue({
        coverages: [],
        rvtExecutions: [],
        lastService: null,
      }),
    };
    const service = new EquipmentQrService(
      repository as never,
      {} as never,
      {} as never,
    );
    const controller = new AssetController({} as never, service);
    return { request, context, repository, controller };
  }

  it.each([FIELD_TECHNICIAN_ROLE_KEY, ASSISTANT_TECHNICIAN_ROLE_KEY])(
    '%s lê equipamentos de diferentes clientes sem atribuição a um atendimento',
    async (roleKey) => {
      const { request, context, controller } = setup(roleKey);
      expect(request.identity!.allowedSurfaces).toEqual(['MOBILE']);
      expect(surfaces.canActivate(context())).toBe(true);
      expect(permissions.canActivate(context())).toBe(true);
      for (const customer of ['a', 'b']) {
        const resolved = await controller.resolveQr(
          customer.repeat(43),
          request,
        );
        expect(resolved.customer?.id).toBe(`customer-${customer}`);
        expect(resolved.name).toBe(`Equipamento ${customer}`);
        expect(resolved.allowedActions).toContain('VIEW_DETAILS');
        expect(resolved.allowedActions).not.toContain('START_SERVICE_ORDER');
      }
    },
  );

  it('não resolve o QR de outro tenant nem de uma unidade fora do escopo', async () => {
    const own = setup(FIELD_TECHNICIAN_ROLE_KEY);
    await expect(
      own.controller.resolveQr('c'.repeat(43), own.request),
    ).rejects.toThrow();
    const outsideUnit = setup(ASSISTANT_TECHNICIAN_ROLE_KEY, 'other-unit');
    await expect(
      outsideUnit.controller.resolveQr('a'.repeat(43), outsideUnit.request),
    ).rejects.toThrow();
    expect(outsideUnit.repository.fieldContext).not.toHaveBeenCalled();
    own.request.identity!.organizationId = 'foreign-org';
    await expect(
      own.controller.resolveQr('a'.repeat(43), own.request),
    ).rejects.toThrow();
    expect(own.repository.identityByTokenHash).toHaveBeenLastCalledWith(
      'a'.repeat(43),
      'foreign-org',
    );
  });

  it('não abre cadastro, alteração ou administração do QR para o app', () => {
    const { context } = setup(FIELD_TECHNICIAN_ROLE_KEY);
    for (const handler of [
      'create',
      'update',
      'remove',
      'ensureQr',
      'rotateQr',
      'revokeQr',
    ] as const) {
      expect(() => surfaces.canActivate(context(handler))).toThrow(
        'Client surface is not allowed',
      );
    }
  });

  it('mantém a exigência do plano e da permissão de leitura', () => {
    const { context, request } = setup(ASSISTANT_TECHNICIAN_ROLE_KEY);
    const targets = [context().getHandler(), context().getClass()];
    expect(reflector.getAllAndOverride(ACTIVE_PLAN_KEY, targets)).toBe(true);
    expect(
      reflector.getAllAndOverride(REQUIRED_CAPABILITIES_KEY, targets),
    ).toEqual(['assets.read']);
    request.user = { ...request.user!, permissions: [] };
    expect(() => permissions.canActivate(context())).toThrow(
      'Missing required permission',
    );
  });
});
