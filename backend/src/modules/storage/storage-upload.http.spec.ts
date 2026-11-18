import { UploadBudgetService } from './upload-budget.service';
import { request as httpRequest, type Server } from 'node:http';
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { RequestContextStorage, RequestContextService } from '../../context';
import { StorageObjectController } from './storage-object.controller';
import { StorageUploadGuard } from './storage-upload.guard';
import { FileObjectService } from './file-object.service';
import { STORAGE_CONFIG } from './storage.config';
import { STORAGE_PROVIDER } from './storage.types';
import { uploadGrant } from './upload-grant';
import { TenantOperationPolicy } from '../tenant-operations/tenant-operation.policy';

const config = {
  localPublicBaseUrl: 'https://orbit.allblue-labs.com',
  localSigningSecret: 'test-only-secret',
};
const organizationId = '01a15a3e-a137-759a-bcd7-7bbad774874f';

describe('signed multipart image gateway', () => {
  let app: INestApplication;
  let receive: jest.Mock;
  let contexts: RequestContextService;
  let body: Buffer;
  let path: string;
  let port: number;
  const policy = {
    assertCapabilityTenant: jest.fn().mockResolvedValue(undefined),
  };
  beforeAll(async () => {
    const contextStorage = new RequestContextStorage();
    contexts = new RequestContextService(contextStorage);
    receive = jest.fn().mockResolvedValue({ id: 'file' });
    const module = await Test.createTestingModule({
      controllers: [StorageObjectController],
      providers: [
        StorageUploadGuard,
        { provide: TenantOperationPolicy, useValue: policy },
        { provide: STORAGE_CONFIG, useValue: config },
        { provide: STORAGE_PROVIDER, useValue: {} },
        {
          provide: FileObjectService,
          useValue: {
            uploadReserved: receive,
            describeUpload: jest.fn(() =>
              Promise.resolve({
                file: { id: 'file' },
                sizeBytes: body.length,
                mimeType: 'image/png',
              }),
            ),
          },
        },
        {
          provide: UploadBudgetService,
          useValue: {
            acquire: jest.fn(() => Promise.resolve(() => Promise.resolve())),
          },
        },
        { provide: RequestContextStorage, useValue: contextStorage },
      ],
    }).compile();
    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.listen(0, '127.0.0.1');
    const address = (app.getHttpServer() as Server).address();
    if (!address || typeof address === 'string')
      throw new Error('Test HTTP server must listen on a TCP port');
    port = address.port;
    body = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#2563eb' },
    })
      .png()
      .toBuffer();
    const signed = uploadGrant(config as never, {
      bucket: 'private',
      objectKey: `avatars/${organizationId}/1-id.png`,
      operation: 'upload',
      expiresInSeconds: 300,
      mimeType: 'image/png',
    });
    path = new URL(signed.url).pathname + new URL(signed.url).search;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    receive.mockClear();
    policy.assertCapabilityTenant.mockReset().mockResolvedValue(undefined);
  });
  it('accepts multipart and scopes the unsigned transport identity to its tenant', async () => {
    receive.mockImplementationOnce(() => {
      expect(contexts.get().organizationId).toBe(organizationId);
      expect(contexts.get().roles).toEqual([]);
      return Promise.resolve();
    });
    await request(app.getHttpServer() as Server)
      .put(path)
      .attach('file', body, { filename: 'foto.png', contentType: 'image/png' })
      .expect(200);
    expect(receive).toHaveBeenCalledWith(
      organizationId,
      'private',
      expect.any(String),
      body,
      'image/png',
    );
    expect(policy.assertCapabilityTenant).toHaveBeenCalledWith(organizationId);
  });
  it('keeps installed raw-PUT mobile clients compatible', async () => {
    await request(app.getHttpServer() as Server)
      .put(path)
      .set('content-type', 'image/png')
      .send(body)
      .expect(200);
    expect(receive).toHaveBeenCalledWith(
      organizationId,
      'private',
      expect.any(String),
      body,
      'image/png',
    );
  });
  it('rejects a tampered grant before parsing or storing the file', async () => {
    await request(app.getHttpServer() as Server)
      .put(path.replace('bucket=private', 'bucket=other'))
      .attach('file', body, 'foto.png')
      .expect(403);
    expect(receive).not.toHaveBeenCalled();
  });
  it('rejects unsupported MIME types and a declared oversized raw upload', async () => {
    await request(app.getHttpServer() as Server)
      .put(path)
      .attach('file', Buffer.from('<svg/>'), {
        filename: 'foto.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400);
    // The header must be rejected before the client sends any file bytes.
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const upload = httpRequest(
        {
          hostname: '127.0.0.1',
          port,
          method: 'PUT',
          path,
          agent: false,
          timeout: 5_000,
          headers: {
            'content-type': 'image/png',
            'content-length': '10000001',
          },
        },
        (response) => {
          response.once('error', reject);
          response.once('end', () => resolve(response.statusCode));
          response.resume();
        },
      );
      upload.once('error', reject);
      upload.once('timeout', () =>
        upload.destroy(new Error('Upload header was not rejected')),
      );
      upload.flushHeaders();
    });
    expect(status).toBe(400);
    expect(receive).not.toHaveBeenCalled();
  });
});
