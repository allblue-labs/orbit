import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { IsEmail, IsString } from 'class-validator';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApiVersioning } from '../src/configure-api';
import { Public } from '../src/decorators';
import {
  BusinessException,
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  RateLimitException,
  UnauthorizedException,
  ValidationException,
} from '../src/exceptions';

class ErrorValidationDto {
  @IsEmail()
  email!: string;

  @IsString()
  name!: string;
}

@Public()
@Controller({ path: '__test/public-errors', version: '1' })
class PublicErrorHarnessController {
  @Post('validation')
  validation(@Body() body: ErrorValidationDto): ErrorValidationDto {
    return body;
  }

  @Get('unauthorized')
  unauthorized(): never {
    throw new UnauthorizedException('Invalid credentials');
  }

  @Get('forbidden')
  forbidden(): never {
    throw new ForbiddenException('Missing capability operations.manage');
  }

  @Get('hidden-absence')
  hiddenAbsence(): never {
    throw new EntityNotFoundException('Customer', '019-secret-foreign-id');
  }

  @Get('duplicate-customer')
  duplicateCustomer(): never {
    throw new ConflictException(
      'Customer document is already registered: Prisma P2002',
      'CUSTOMER_DOCUMENT_ALREADY_EXISTS',
    );
  }

  @Get('occ')
  occ(): never {
    throw new ConflictException(
      'Customer service request version is stale',
      'STALE_VERSION',
    );
  }

  @Get('rate-limit')
  rateLimit(): never {
    throw new RateLimitException(30);
  }

  @Get('file')
  file(): never {
    throw new ValidationException(
      'Invalid S3 object magic bytes in bucket orbit-secret',
      undefined,
      'FILE_INVALID',
    );
  }

  @Get('portal-token')
  portalToken(): never {
    throw new UnauthorizedException('Invalid portal JWT signature');
  }

  @Get('service-request-transition')
  serviceRequestTransition(): never {
    throw new BusinessException(
      'Transition OPEN -> COMPLETED is not allowed',
      'INVALID_STATUS_TRANSITION',
    );
  }

  @Get('unknown')
  unknown(): never {
    throw new Error(
      'Prisma P2002 SQL constraint stack node_modules postgres RLS',
    );
  }
}

interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
  };
  requestId: string;
  timestamp: string;
}

const forbiddenLeaks =
  /Prisma|P2002|SQL|constraint|stack|node_modules|postgres|RLS|capabilit|operations\.manage|019-secret|bucket|S3|OPEN\s*->\s*COMPLETED/i;

describe('Public Error Contract (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PublicErrorHarnessController],
    }).compile();
    app = fixture.createNestApplication();
    configureApiVersioning(app);
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.listen(0, '127.0.0.1');
  });

  afterAll(() => app.close());

  const get = (path: string) =>
    request(app.getHttpServer()).get(`/api/v1/__test/public-errors/${path}`);

  function expectContract(body: ErrorBody, status: number, code: string): void {
    expect(body.success).toBe(false);
    expect(body.error.code).toBe(code);
    expect(body.error.status).toBe(status);
    expect(typeof body.error.message).toBe('string');
    expect(typeof body.requestId).toBe('string');
    expect(typeof body.timestamp).toBe('string');
    expect(body.error.message.trim()).not.toBe('');
    expect(JSON.stringify(body)).not.toMatch(forbiddenLeaks);
  }

  it('publishes structured and redacted validation issues', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/__test/public-errors/validation')
      .send({ email: 'not-an-email', name: 'Orbit', passwordHash: 'secret' })
      .expect(HttpStatus.BAD_REQUEST);
    const body = response.body as ErrorBody;
    expectContract(body, 400, 'VALIDATION_ERROR');
    expect(body.error.message).toBe('Revise os campos informados.');
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'email',
          code: 'INVALID_FORMAT',
          message: 'Informe um e-mail válido.',
        }),
        expect.objectContaining({
          field: 'passwordHash',
          code: 'UNKNOWN_FIELD',
        }),
      ]),
    );
    expect(JSON.stringify(body)).not.toContain('not-an-email');
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it.each([
    ['unauthorized', 401, 'UNAUTHORIZED'],
    ['forbidden', 403, 'FORBIDDEN'],
    ['hidden-absence', 404, 'ENTITY_NOT_FOUND'],
    ['duplicate-customer', 409, 'CUSTOMER_DOCUMENT_ALREADY_EXISTS'],
    ['occ', 409, 'STALE_VERSION'],
    ['file', 400, 'FILE_INVALID'],
    ['portal-token', 401, 'UNAUTHORIZED'],
    ['service-request-transition', 422, 'INVALID_STATUS_TRANSITION'],
    ['unknown', 500, 'INTERNAL_SERVER_ERROR'],
  ] as const)('%s maps to %s/%s without leaks', async (path, status, code) => {
    const response = await get(path).expect(status);
    expectContract(response.body as ErrorBody, status, code);
  });

  it('publishes stable rate-limit metadata and Retry-After', async () => {
    const response = await get('rate-limit')
      .expect(HttpStatus.TOO_MANY_REQUESTS)
      .expect('Retry-After', '30');
    const body = response.body as ErrorBody;
    expectContract(body, 429, 'RATE_LIMITED');
    expect(body.error.details).toEqual({ retryAfterSeconds: 30 });
  });
});
