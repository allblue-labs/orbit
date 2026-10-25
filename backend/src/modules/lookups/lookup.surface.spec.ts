/**
 * As rotas de consulta precisam aceitar o aplicativo.
 *
 * ## O defeito que este teste existe para impedir
 *
 * `AuthorizationGuard` usa `['WEB','API']` quando o controlador não declara
 * superfície — por desenho, para que acesso móvel seja sempre explícito. O
 * efeito, se o decorador faltar aqui, é que a sessão do celular é recusada com
 * "Client surface is not allowed" — e o módulo todo perde a razão de existir: a
 * web já consultava CEP pelo BFF dela, e quem ficou sem busca de endereço foi
 * justamente o técnico em campo.
 *
 * É um defeito invisível: compila, passa em todo teste de serviço, e só aparece
 * com um celular na mão.
 */
import { SURFACES_KEY } from '../../decorators';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthorizationService } from '../../common/authorization.service';
import {
  AuthenticationGuard,
  PermissionGuard,
  SurfaceGuard,
} from '../../guards/foundation.guards';
import {
  ASSIGNABLE_TEAM_ROLES,
  ASSISTANT_TECHNICIAN_ROLE_KEY,
  FIELD_TECHNICIAN_ROLE_KEY,
} from '../organizations/team-roles';
import { LookupController } from './lookup.controller';

describe('superfícies das consultas públicas', () => {
  const declaradas = Reflect.getMetadata(SURFACES_KEY, LookupController) as
    string[] | undefined;

  it('o controlador declara as superfícies', () => {
    expect(declaradas).toBeDefined();
  });

  it('aceita o aplicativo de campo', () => {
    expect(declaradas).toContain('MOBILE');
  });

  it('continua aceitando a web', () => {
    /* A web passa a poder usar a mesma rota em vez do BFF próprio: duas
       implementações da mesma consulta divergem na primeira mudança. */
    expect(declaradas).toContain('WEB');
  });
});

describe('acesso de campo às consultas de CEP e CNPJ', () => {
  const reflector = new Reflector();
  const authentication = new AuthenticationGuard(reflector);
  const surfaces = new SurfaceGuard(reflector);
  const permissions = new PermissionGuard(
    reflector,
    new AuthorizationService(),
  );
  const methods = ['postalCode', 'company'] as const;

  function context(
    method: (typeof methods)[number],
    actor?: {
      permissions: readonly string[];
      allowedSurfaces: readonly string[];
      isOrganizationOwner: boolean;
    },
  ) {
    return {
      // Guards inspect metadata on the original handler; never invoke it here.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      getHandler: () => LookupController.prototype[method],
      getClass: () => LookupController,
      switchToHttp: () => ({ getRequest: () => ({ user: actor }) }),
    } as unknown as ExecutionContext;
  }

  it.each([FIELD_TECHNICIAN_ROLE_KEY, ASSISTANT_TECHNICIAN_ROLE_KEY])(
    '%s consulta CEP e CNPJ com as permissões reais do papel',
    (roleKey) => {
      const role = ASSIGNABLE_TEAM_ROLES.find((item) => item.key === roleKey)!;
      expect(role.permissions).not.toContain('customers.create');
      for (const method of methods) {
        const request = context(method, {
          permissions: role.permissions,
          allowedSurfaces: role.allowedSurfaces,
          isOrganizationOwner: false,
        });
        expect(authentication.canActivate(request)).toBe(true);
        expect(surfaces.canActivate(request)).toBe(true);
        expect(permissions.canActivate(request)).toBe(true);
      }
    },
  );

  it.each(methods)('%s continua disponível na web e na API', (method) => {
    for (const surface of ['WEB', 'API']) {
      const request = context(method, {
        permissions: ['customers.read'],
        allowedSurfaces: [surface],
        isOrganizationOwner: false,
      });
      expect(surfaces.canActivate(request)).toBe(true);
      expect(permissions.canActivate(request)).toBe(true);
    }
  });

  it.each(methods)('%s exige autenticação e acesso de leitura', (method) => {
    expect(() => authentication.canActivate(context(method))).toThrow();
    expect(() =>
      permissions.canActivate(
        context(method, {
          permissions: [],
          allowedSurfaces: ['MOBILE'],
          isOrganizationOwner: false,
        }),
      ),
    ).toThrow('Missing required permission');
  });
});
