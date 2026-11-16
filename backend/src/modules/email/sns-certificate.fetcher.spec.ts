import dns from 'node:dns/promises';
import https from 'node:https';
import type { RequestOptions } from 'node:https';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { SnsCertificateFetcher } from './sns-certificate.fetcher';

describe('SNS certificate transport, with no network', () => {
  afterEach(() => jest.restoreAllMocks());
  it('rejects any private/mixed DNS answer before opening a socket', async () => {
    jest.spyOn(dns, 'lookup').mockImplementation((() =>
      Promise.resolve([
        { address: '3.1.1.1', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ])) as unknown as typeof dns.lookup);
    const network = jest.spyOn(https, 'get').mockImplementation(() => {
      throw new Error('NETWORK_MUST_NOT_RUN');
    });
    await expect(
      new SnsCertificateFetcher().fetch(
        new URL(
          'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-demo.pem',
        ),
      ),
    ).rejects.toMatchObject({ code: 'SNS_CERTIFICATE_DNS_DENIED' });
    expect(network).not.toHaveBeenCalled();
  });
  it.each([302, 200])(
    'pins public IP/TLS hostname and rejects redirect or oversized body (%s)',
    async (statusCode) => {
      jest
        .spyOn(dns, 'lookup')
        .mockImplementation((() =>
          Promise.resolve([
            { address: '3.1.1.1', family: 4 },
          ])) as unknown as typeof dns.lookup);
      let options: RequestOptions | undefined;
      const request = Object.assign(new EventEmitter(), { destroy: jest.fn() });
      const response = Object.assign(new EventEmitter(), {
        statusCode,
        resume: jest.fn(),
      });
      jest.spyOn(https, 'get').mockImplementation(((
        input: RequestOptions,
        callback: (response: IncomingMessage) => void,
      ) => {
        options = input;
        queueMicrotask(() => {
          callback(response as unknown as IncomingMessage);
          if (statusCode === 200)
            response.emit('data', Buffer.alloc(65 * 1024));
        });
        return request as unknown as ClientRequest;
      }) as typeof https.get);
      await expect(
        new SnsCertificateFetcher().fetch(
          new URL(
            'https://sns.us-east-2.amazonaws.com/SimpleNotificationService-demo.pem',
          ),
        ),
      ).rejects.toMatchObject({
        code:
          statusCode === 302
            ? 'SNS_CERTIFICATE_UNAVAILABLE'
            : 'SNS_CERTIFICATE_TOO_LARGE',
      });
      expect(options).toMatchObject({
        hostname: '3.1.1.1',
        servername: 'sns.us-east-2.amazonaws.com',
        port: 443,
        rejectUnauthorized: true,
      });
      expect(options?.ca).toBeDefined();
      expect(options?.checkServerIdentity).toBeDefined();
      expect(request.destroy).toHaveBeenCalled();
    },
  );
});
