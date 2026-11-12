import 'reflect-metadata';
import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  type RawBodyRequest,
} from '@nestjs/common';
import {
  FileInterceptor,
  type NestExpressApplication,
} from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import {
  request as httpRequest,
  type IncomingMessage,
  type Server as HttpServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { memoryStorage } from 'multer';
import { Server as SocketServer } from 'socket.io';
import request from 'supertest';
import { configureHttpParsers } from '../configure-http-parsers';

/** Exercise the installed HTTP/multipart/Engine.IO stack without a database. */
@Controller('transport-probe')
class TransportProbeController {
  @Get('health')
  health() {
    return { ok: true };
  }

  @Post('json')
  json(
    @Body() body: Record<string, unknown>,
    @Req() req: RawBodyRequest<Request>,
  ) {
    return { body, rawBody: req.rawBody?.toString('base64') };
  }

  @Post('file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 1024, files: 1 },
    }),
  )
  file(@UploadedFile() file: Express.Multer.File) {
    return { name: file.originalname, content: file.buffer.toString('base64') };
  }
}

describe('security regressions in transport dependencies', () => {
  let app: NestExpressApplication;
  let server: HttpServer;
  let sockets: SocketServer;
  let port: number;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [TransportProbeController],
    }).compile();
    app = module.createNestApplication<NestExpressApplication>({
      rawBody: true,
      bodyParser: false,
      logger: false,
    });
    configureHttpParsers(app);
    server = app.getHttpServer<HttpServer>();
    sockets = new SocketServer(server);
    await app.listen(0, '127.0.0.1');
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await sockets?.close();
    await app?.close();
  });

  function postJson(body: Buffer, encoding?: string) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port,
          path: '/transport-probe/json',
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': body.length,
            ...(encoding ? { 'content-encoding': encoding } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on('error', reject);
      req.setTimeout(2000, () =>
        req.destroy(new Error('HTTP probe timed out')),
      );
      req.end(body);
    });
  }

  async function healthy() {
    await request(server)
      .get('/transport-probe/health')
      .expect(200, { ok: true });
  }

  it('preserves exact raw webhook bytes and accepts valid compressed JSON', async () => {
    const raw = Buffer.from('{ "value": 1, "event": "probe" }');
    for (const [bytes, encoding] of [
      [raw, undefined],
      [gzipSync(raw), 'gzip'],
    ] as const) {
      const response = await postJson(bytes, encoding);
      expect(response.status).toBe(201);
      expect(JSON.parse(response.body)).toEqual({
        body: { value: 1, event: 'probe' },
        rawBody: raw.toString('base64'),
      });
    }
  });

  it('rejects compressed trailing junk without crashing or poisoning later requests', async () => {
    // GHSA-27r3-jxmh-p828: the error can arrive after the decompressed body.
    const invalid = Buffer.concat([
      gzipSync(Buffer.from('{"value":1}')),
      Buffer.from('trailing-junk'),
    ]);
    const response = await postJson(invalid, 'gzip');
    expect(response.status).toBe(400);
    await healthy();
  });

  it('rejects malformed and oversized JSON, including expanded gzip bodies', async () => {
    expect((await postJson(Buffer.from('{"value":'))).status).toBe(400);
    const large = Buffer.from(
      JSON.stringify({ value: 'x'.repeat(1024 * 1024) }),
    );
    expect((await postJson(large)).status).toBe(413);
    expect((await postJson(gzipSync(large), 'gzip')).status).toBe(413);
    await healthy();
  });

  it('keeps form decoding and raw bytes compatible', async () => {
    const form = 'name=Jo%C3%A3o&address%5Bcity%5D=Paulista';
    await request(server)
      .post('/transport-probe/json')
      .set('content-type', 'application/x-www-form-urlencoded')
      .send(form)
      .expect(201, {
        body: { name: 'João', address: { city: 'Paulista' } },
        rawBody: Buffer.from(form).toString('base64'),
      });
  });

  it('accepts a file and rejects oversized, extra and truncated multipart data', async () => {
    const bytes = Buffer.from('evidence');
    await request(server)
      .post('/transport-probe/file')
      .attach('file', bytes, 'evidence.txt')
      .expect(201, { name: 'evidence.txt', content: bytes.toString('base64') });
    await request(server)
      .post('/transport-probe/file')
      .attach('file', Buffer.alloc(1025), 'large.txt')
      .expect(413);
    await request(server)
      .post('/transport-probe/file')
      .attach('file', bytes, 'first.txt')
      .attach('file', bytes, 'second.txt')
      .expect(400);
    await request(server)
      .post('/transport-probe/file')
      .set('content-type', 'multipart/form-data; boundary=probe')
      .send(
        '--probe\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\n\r\nunfinished',
      )
      .expect(400);
    await healthy();
  });

  it('survives a client disconnect in the middle of an upload', async () => {
    await new Promise<void>((resolve, reject) => {
      const upload = httpRequest({
        host: '127.0.0.1',
        port,
        path: '/transport-probe/file',
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=probe',
          'content-length': 100_000,
        },
      });
      const onRequest = (incoming: IncomingMessage) => {
        incoming.once('aborted', resolve);
        upload.destroy();
      };
      server.once('request', onRequest);
      upload.on('error', (error: NodeJS.ErrnoException) => {
        server.removeListener('request', onRequest);
        if (error.code !== 'ECONNRESET') reject(error);
      });
      upload.setTimeout(2000, () =>
        upload.destroy(new Error('Upload probe timed out')),
      );
      upload.write(
        '--probe\r\nContent-Disposition: form-data; name="file"; filename="photo.png"\r\n\r\npartial',
      );
    });
    await healthy();
  });

  it('rejects mismatched Engine.IO upgrades and still accepts the matching revision', async () => {
    await request(server)
      .get('/socket.io/?EIO=3&transport=polling')
      .expect(400);
    const handshake = await request(server)
      .get('/socket.io/?EIO=4&transport=polling')
      .expect(200)
      .expect((response) => {
        expect(response.text).toMatch(/^0\{"sid":/);
      });
    const { sid } = JSON.parse(handshake.text.slice(1)) as { sid: string };
    const upgrade = (revision?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port,
            path: `/socket.io/?transport=websocket&sid=${encodeURIComponent(sid)}${revision ? `&EIO=${revision}` : ''}`,
            headers: {
              connection: 'Upgrade',
              upgrade: 'websocket',
              'sec-websocket-version': '13',
              'sec-websocket-key': 'b3JiaXQtcHJvYmUtdGVzdA==',
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode!);
          },
        );
        req.on('upgrade', (_res, socket) => {
          socket.destroy();
          resolve(101);
        });
        req.on('error', reject);
        req.setTimeout(2000, () =>
          req.destroy(new Error('Upgrade probe timed out')),
        );
        req.end();
      });
    // GHSA-2gc4-cqfq-p2gv concerns upgrades of an existing session, not just
    // rejection of EIO=3 during an initial handshake. Missing EIO matters too.
    expect(await upgrade('3')).toBe(400);
    expect(await upgrade()).toBe(400);
    expect(await upgrade('4')).toBe(101);
    await healthy();
  });
});
