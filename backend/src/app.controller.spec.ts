import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './database';
import { HotpathRedis } from './common/hotpath/hotpath-redis';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: HotpathRedis, useValue: { readiness: 'degraded' } },
        {
          provide: PrismaService,
          useValue: {
            $transaction: jest.fn((work: (tx: object) => Promise<unknown>) =>
              work({ $executeRaw: jest.fn(), $queryRaw: jest.fn() }),
            ),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });

  describe('health probes', () => {
    it('separates process liveness from dependency readiness', async () => {
      expect(appController.liveness()).toEqual({ status: 'ok' });
      await expect(appController.readiness()).resolves.toEqual({
        status: 'degraded',
        checks: { postgres: 'ok', jobs: 'ok', redis: 'degraded' },
      });
    });
  });
});
