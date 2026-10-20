import { Logger } from '@nestjs/common';
import { FoundationExceptionFilter } from './foundation-exception.filter';

describe('FoundationExceptionFilter production logging', () => {
  const previousNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = previousNodeEnv;
    jest.restoreAllMocks();
  });

  it('does not write exception messages, stacks or query strings to logs', () => {
    process.env.NODE_ENV = 'production';
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
    };
    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => ({
          method: 'GET',
          originalUrl:
            '/api/v1/documents?token=SENSITIVE_LOG_SECRET_MUST_NOT_LEAK',
          path: '/api/v1/documents',
          id: 'request-id',
        }),
      }),
    };

    new FoundationExceptionFilter().catch(
      new Error('provider token SENSITIVE_LOG_SECRET_MUST_NOT_LEAK'),
      host as never,
    );

    const serialized = JSON.stringify(logged.mock.calls);
    expect(serialized).not.toContain('SENSITIVE_LOG_SECRET_MUST_NOT_LEAK');
    expect(serialized).toContain('/api/v1/documents');
    expect(response.status).toHaveBeenCalledWith(500);
  });
});
