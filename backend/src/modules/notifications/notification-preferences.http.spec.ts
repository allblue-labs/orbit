import 'reflect-metadata';
import type { Server } from 'node:http';
import {
  ValidationPipe,
  type INestApplication,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { configureApiVersioning } from '../../configure-api';
import { PermissionGuard, SurfaceGuard } from '../../guards/foundation.guards';
import { UnauthorizedException } from '../../exceptions';
import { NotificationController } from './notification.controller';
import { NotificationPreferencesController } from './notification-preferences.controller';
import { NotificationService } from './notification.service';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';

describe('notification preferences HTTP routes for a mobile-only operator', () => {
  let app: INestApplication<Server>;
  const preferences = jest.fn().mockResolvedValue([]);
  const preference = jest
    .fn()
    .mockImplementation((_org, _user, input: unknown) => input);
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [NotificationPreferencesController, NotificationController],
      providers: [
        { provide: NotificationService, useValue: { preferences, preference } },
      ],
    }).compile();
    app = module.createNestApplication();
    configureApiVersioning(app);
    const reflector = new Reflector();
    app.useGlobalGuards(
      {
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<IdentityRequest>();
          if (req.header('authorization') !== 'Bearer test-mobile-session')
            throw new UnauthorizedException();
          req.identity = { id: 'operator-a', organizationId: 'org-a' } as never;
          req.user = {
            id: 'operator-a',
            roles: [],
            permissions: [],
            businessUnitIds: [],
            allowedSurfaces: ['MOBILE'],
            isOrganizationOwner: false,
          };
          return true;
        },
      },
      new SurfaceGuard(reflector),
      new PermissionGuard(reflector, { hasPermissions: () => false } as never),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });
  afterAll(async () => {
    await app?.close();
  });
  beforeEach(() => jest.clearAllMocks());

  for (const prefix of ['', '/api/v1']) {
    it(`GET ${prefix}/notifications/preferences reaches personal preferences`, async () => {
      await request(app.getHttpServer())
        .get(`${prefix}/notifications/preferences`)
        .set('authorization', 'Bearer test-mobile-session')
        .expect(200)
        .expect([]);
      expect(preferences).toHaveBeenCalledWith('org-a', 'operator-a');
    });
    it(`PATCH ${prefix}/notifications/preferences saves only the caller's choice`, async () => {
      const input = { type: 'WORK_ASSIGNED', enabled: false, channels: [] };
      await request(app.getHttpServer())
        .patch(`${prefix}/notifications/preferences`)
        .set('authorization', 'Bearer test-mobile-session')
        .send(input)
        .expect(200);
      expect(preference).toHaveBeenCalledWith('org-a', 'operator-a', input);
    });
  }
  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/notifications/preferences')
      .expect(401);
    expect(preferences).not.toHaveBeenCalled();
  });
  it('rejects a different recipient or tenant in the payload', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/notifications/preferences')
      .set('authorization', 'Bearer test-mobile-session')
      .send({
        type: 'WORK_ASSIGNED',
        enabled: false,
        channels: [],
        userId: 'operator-b',
        organizationId: 'org-b',
      })
      .expect(400);
    expect(preference).not.toHaveBeenCalled();
  });
});
