/**
 * O envelope global, e a única coisa que ele não embrulha.
 *
 * Este teste existe por causa de um defeito real: a rota de preview definia
 * `Content-Type: application/pdf` e devolvia `StreamableFile`, o interceptor
 * embrulhava o stream em `{ success, data }`, e a resposta saía com cabeçalho
 * de PDF e corpo JSON. O navegador salvava o arquivo, o arquivo não abria, e
 * nada na resposta dizia por quê.
 */
import { StreamableFile, type CallHandler } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';
import { ResponseInterceptor } from './foundation.interceptors';

function contexto(): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ id: 'req-1' }) }),
  } as unknown as ExecutionContext;
}

function proximo<T>(valor: T): CallHandler<T> {
  return { handle: () => of(valor) };
}

describe('ResponseInterceptor', () => {
  it('embrulha o resultado no envelope da API', async () => {
    const interceptor = new ResponseInterceptor();

    const resposta = await lastValueFrom(
      interceptor.intercept(contexto(), proximo({ id: 'plano-1' })),
    );

    expect(resposta).toMatchObject({
      success: true,
      data: { id: 'plano-1' },
      requestId: 'req-1',
    });
  });

  it('deixa passar o arquivo sem embrulhar', async () => {
    const interceptor = new ResponseInterceptor();
    const arquivo = new StreamableFile(Buffer.from('%PDF-1.3'));

    const resposta = await lastValueFrom(
      interceptor.intercept(contexto(), proximo(arquivo)),
    );

    expect(resposta).toBe(arquivo);
  });
});
