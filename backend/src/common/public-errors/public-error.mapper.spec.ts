import {
  BadRequestException,
  ForbiddenException as NestForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ConflictException,
  EntityNotFoundException,
  RateLimitException,
} from '../../exceptions';
import { PublicErrorMapper } from './public-error.mapper';

describe('PublicErrorMapper', () => {
  const mapper = new PublicErrorMapper();

  it('maps ValidationPipe messages to safe field issues', () => {
    const result = mapper.map(
      new BadRequestException([
        'email must be an email',
        'property passwordHash should not exist',
      ]),
    );
    expect(result).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Revise os campos informados.',
      status: 400,
      details: [
        {
          field: 'email',
          code: 'INVALID_FORMAT',
          message: 'Informe um e-mail válido.',
        },
        {
          field: 'passwordHash',
          code: 'UNKNOWN_FIELD',
          message: 'Este campo não é aceito.',
        },
      ],
    });
  });

  it('does not expose identifiers from hidden absence errors', () => {
    const result = mapper.map(
      new EntityNotFoundException('Customer', '019-secret-id'),
    );
    expect(result).toMatchObject({
      code: 'ENTITY_NOT_FOUND',
      message: 'O recurso solicitado não foi encontrado.',
      status: 404,
    });
    expect(JSON.stringify(result)).not.toContain('019-secret-id');
  });

  it('maps registered domain codes without exposing their internal messages', () => {
    const result = mapper.map(
      new ConflictException(
        'Customer document is already registered; Prisma P2002',
        'CUSTOMER_DOCUMENT_ALREADY_EXISTS',
      ),
    );
    expect(result).toMatchObject({
      code: 'CUSTOMER_DOCUMENT_ALREADY_EXISTS',
      message: 'Já existe um cliente cadastrado com este CPF ou CNPJ.',
      status: 409,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /Prisma|P2002|Customer document/,
    );
  });

  it('falls back by HTTP semantics for an unregistered application code', () => {
    expect(
      mapper.map(new ConflictException('internal detail', 'UNREGISTERED')),
    ).toMatchObject({ code: 'CONFLICT', status: 409 });
  });

  it('preserves bounded retry metadata and no implementation detail', () => {
    expect(mapper.map(new RateLimitException(45))).toEqual({
      code: 'RATE_LIMITED',
      message: 'Muitas tentativas. Aguarde e tente novamente.',
      status: 429,
      details: { retryAfterSeconds: 45 },
    });
  });

  it('maps built-in authorization and infrastructure errors safely', () => {
    expect(
      mapper.map(
        new NestForbiddenException('Missing capability operations.manage'),
      ),
    ).toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(
      mapper.map(
        new ServiceUnavailableException('PostgreSQL connection refused'),
      ),
    ).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'O serviço está temporariamente indisponível. Tente novamente.',
      status: 503,
    });
  });

  it('maps unexpected errors to a safe fallback', () => {
    const result = mapper.map(
      new Error('Prisma P2002 SQL constraint stack node_modules/postgres'),
    );
    expect(result).toEqual({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Não foi possível concluir a solicitação.',
      status: 500,
    });
  });
});

describe('erro de fora do Nest que declara status', () => {
  /**
   * `body-parser` recusa corpo grande com um `Error` comum de `http-errors`:
   * `status: 413`, `expose: true`. Sem ler isso, o filtro achatava para 500, e
   * "não foi possível concluir a solicitação" não conta a ninguém que mandou
   * 2 MB onde cabe 1.
   */
  function httpError(status: number, expose: boolean): Error {
    return Object.assign(new Error('request entity too large'), {
      status,
      expose,
      type: 'entity.too.large',
    });
  }

  it('traduz corpo grande demais para 413 com mensagem de tamanho', () => {
    const mapper = new PublicErrorMapper();

    const resultado = mapper.map(httpError(413, true));

    expect(resultado.status).toBe(413);
    expect(resultado.code).toBe('PAYLOAD_TOO_LARGE');
    expect(resultado.message).toMatch(/tamanho/i);
  });

  it('ignora status pendurado em erro que não é para mostrar', () => {
    /* `expose: false` é a marca de erro interno. Honrar o status dele vazaria
       detalhe de implementação como se fosse recusa de negócio. */
    const mapper = new PublicErrorMapper();

    expect(mapper.map(httpError(404, false)).status).toBe(500);
  });

  it('ignora status de servidor pendurado em erro exposto', () => {
    /* A leitura é só de 4xx — recusa do cliente. Um 5xx anunciado por um erro
       comum continua sendo falha interna: quem declara indisponibilidade de
       serviço é uma `HttpException`, não um objeto com um campo `status`. */
    const mapper = new PublicErrorMapper();

    const resultado = mapper.map(httpError(503, true));

    expect(resultado.status).toBe(500);
    expect(resultado.code).toBe('INTERNAL_SERVER_ERROR');
  });
});
