import { OrbitLogger } from './orbit-logger';
import { safeCorrelationId } from './correlation';

describe('redacted operational events', () => {
  it('accepts a correlation UUID and rejects arbitrary client material', () => {
    expect(
      safeCorrelationId('ece8e94c-0f19-4d1a-92da-fea921397c63'),
    ).toBeTruthy();
    expect(safeCorrelationId('header-log-token-canary')).toBeUndefined();
  });

  it('writes structural fields without serializing provider errors or arbitrary nested data', () => {
    const output: string[] = [];
    const sink = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array) => {
        output.push(String(chunk));
        return true;
      });
    try {
      const logger = new OrbitLogger();
      logger.error(
        {
          event: 'job_failed',
          durationMs: 15,
          correlationId: 'ece8e94c-0f19-4d1a-92da-fea921397c63',
          token: 'secret-canary-jwt',
          path: '/public/quotes/proposals/secret-canary-proposal',
          metadata: { password: 'secret-canary-password' },
          authorization: 'secret-canary-authorization',
        },
        'secret-canary-stack-https://example.test',
        'Worker',
      );
      expect(output.join('')).not.toContain('secret-canary');
      expect(JSON.parse(output[0]!)).toMatchObject({
        event: 'job_failed',
        durationMs: 15,
        level: 'error',
        correlationId: 'ece8e94c-0f19-4d1a-92da-fea921397c63',
        organizationId: null,
        userId: null,
      });
    } finally {
      sink.mockRestore();
    }
  });
});
