import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import type { ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable, lastValueFrom } from 'rxjs';
import { RequestContext, RequestContextStorage } from '../../context';
import type { UUID } from '../../contracts';
import { UploadLimitsInterceptor } from './upload-limits.interceptor';
import type { UploadBudgetService } from './upload-budget.service';
import { UPLOAD_LIMITS } from './upload-budget.service';
import { UPLOAD_RESERVATION } from './upload-context';

function fixture(length?: string) {
  const release = jest.fn().mockResolvedValue(undefined);
  const budgets = { acquire: jest.fn().mockResolvedValue(release) };
  const contexts = new RequestContextStorage();
  const context = new RequestContext({
    requestId: 'test',
    organizationId: '01a15a3e-a137-759a-bcd7-7bbad774874f' as UUID,
    userId: null,
    businessUnitId: null,
    businessUnitIds: [],
    roles: [],
    permissions: [],
    ip: null,
    userAgent: null,
    locale: 'pt-BR',
  });
  const req = Object.assign(new PassThrough(), {
    complete: false,
    header: (name: string) =>
      name === 'content-length'
        ? length
        : name === 'content-type'
          ? 'application/pdf'
          : undefined,
    is: () => false,
    setTimeout: jest.fn(),
    [UPLOAD_RESERVATION]: {
      id: 'file',
      sizeBytes: 3,
      mimeType: 'application/pdf',
      context,
    },
  });
  const response = Object.assign(new EventEmitter(), { setHeader: jest.fn() });
  const execution = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  const next: CallHandler = {
    handle: () =>
      new Observable(() => {
        req.resume();
      }),
  };
  return {
    req,
    response,
    release,
    budgets,
    context,
    contexts,
    execution,
    next,
    interceptor: new UploadLimitsInterceptor(
      budgets as unknown as UploadBudgetService,
      contexts,
    ),
  };
}
afterEach(() => jest.useRealTimers());
describe('upload wire/deadline limits before parser buffering', () => {
  it('refuses an oversized declared body before admission', async () => {
    const f = fixture('4');
    await expect(
      f.interceptor.intercept(f.execution, f.next),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    expect(f.budgets.acquire).not.toHaveBeenCalled();
  });
  it('refuses excess chunked bytes and releases admission on termination', async () => {
    const f = fixture();
    const stream = await f.interceptor.intercept(f.execution, f.next);
    const check = expect(lastValueFrom(stream)).rejects.toMatchObject({
      status: 413,
    });
    f.req.write(Buffer.alloc(4));
    await check;
    expect(f.response.setHeader).toHaveBeenCalledWith('Connection', 'close');
    expect(f.release).toHaveBeenCalledTimes(1);
    f.req.destroy();
  });
  it('aborts a slow upload at its absolute deadline', async () => {
    jest.useFakeTimers();
    const f = fixture();
    const check = expect(
      lastValueFrom(await f.interceptor.intercept(f.execution, f.next)),
    ).rejects.toMatchObject({ status: 408 });
    await jest.advanceTimersByTimeAsync(UPLOAD_LIMITS.bodyMs);
    await check;
    expect(f.release).toHaveBeenCalledTimes(1);
    f.req.destroy();
  });
  it('binds idle timeout and cancels a client-aborted body without invoking completion', async () => {
    const f = fixture();
    const check = expect(
      lastValueFrom(await f.interceptor.intercept(f.execution, f.next)),
    ).rejects.toMatchObject({ status: 400 });
    expect(f.req.setTimeout).toHaveBeenCalledWith(
      UPLOAD_LIMITS.idleMs,
      expect.any(Function),
    );
    f.req.emit('aborted');
    await check;
    expect(f.release).toHaveBeenCalledTimes(1);
    f.req.destroy();
  });
});
