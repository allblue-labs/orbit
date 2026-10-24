import type { INestApplication, Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import type { App } from 'supertest/types';
import { configureApiVersioning } from '../../configure-api';
import { ChecklistService } from './checklist.service';
import { OperationCancellationService } from './operation-cancellation.service';
import { OperationReadModelMapper } from './operation.mapper';
import { OperationService } from './operation.service';
import { OperationsModule } from './operations.module';

const ORGANIZATION_ID = '01900000-0000-7000-8000-000000000001';
const ACTOR_ID = '01900000-0000-7000-8000-000000000002';
const OPERATION_ID = '01900000-0000-7000-8000-000000000003';
const REQUEST_ID = '01900000-0000-7000-8000-000000000004';

describe('Operations HTTP routing', () => {
  let app: INestApplication<App>;
  const cancellations = {
    inbox: jest.fn().mockResolvedValue([]),
    resolve: jest.fn().mockResolvedValue({ operationId: OPERATION_ID }),
  };
  const operations = {
    get: jest.fn().mockResolvedValue({ id: OPERATION_ID }),
  };
  const readModels = {
    details: jest.fn().mockReturnValue({ id: OPERATION_ID }),
  };

  beforeAll(async () => {
    // Preserve the production controller order: /operations/:id must not
    // capture /operations/cancellation-requests and reject it as a UUID.
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      OperationsModule,
    ) as Type<unknown>[];
    const moduleRef = await Test.createTestingModule({
      controllers,
      providers: [
        { provide: OperationService, useValue: operations },
        { provide: OperationReadModelMapper, useValue: readModels },
        { provide: ChecklistService, useValue: {} },
        { provide: OperationCancellationService, useValue: cancellations },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApiVersioning(app);
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, {
        identity: {
          id: ACTOR_ID,
          organizationId: ORGANIZATION_ID,
          permissions: ['operations.read', 'operations.status.update'],
        },
      });
      next();
    });
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    cancellations.inbox.mockResolvedValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('loads an empty cancellation inbox without parsing the route as an ID', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/operations/cancellation-requests?status=PENDING')
      .expect(200, []);

    expect(cancellations.inbox).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      'PENDING',
    );
    expect(operations.get).not.toHaveBeenCalled();
  });

  it('returns pending requests from the cancellation service', async () => {
    const pending = [{ id: REQUEST_ID, reason: 'Cliente ausente.' }];
    cancellations.inbox.mockResolvedValueOnce(pending);

    await request(app.getHttpServer())
      .get('/api/v1/operations/cancellation-requests')
      .expect(200, pending);
    expect(cancellations.inbox).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      'PENDING',
    );
  });

  it('routes the resolved inbox to the same controller', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/operations/cancellation-requests?status=RESOLVED')
      .expect(200, []);
    expect(cancellations.inbox).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      'RESOLVED',
    );
  });

  it('still loads an operation by UUID', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/operations/${OPERATION_ID}`)
      .expect(200, { id: OPERATION_ID });
    expect(operations.get).toHaveBeenCalledWith(OPERATION_ID, ORGANIZATION_ID);
    expect(cancellations.inbox).not.toHaveBeenCalled();
  });

  it('continues rejecting invalid operation IDs', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/operations/invalid-id')
      .expect(400);
    expect(operations.get).not.toHaveBeenCalled();
    expect(cancellations.inbox).not.toHaveBeenCalled();
  });

  it('routes cancellation decisions to the cancellation controller', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/operations/cancellation-requests/${REQUEST_ID}/resolve`)
      .send({ resolution: 'DISMISSED' })
      .expect(201, { operationId: OPERATION_ID });
    expect(cancellations.resolve).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      ACTOR_ID,
      REQUEST_ID,
      { resolution: 'DISMISSED' },
    );
  });
});
