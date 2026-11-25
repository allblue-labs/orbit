import { Injectable } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { get } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkServerIdentity, rootCertificates } from 'node:tls';
import { SesFeedbackError } from './ses-feedback.types';

const blocked = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(network, prefix, 'ipv4');
const global6 = new BlockList();
global6.addSubnet('2000::', 3, 'ipv6');
for (const [network, prefix] of [
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
] as const)
  blocked.addSubnet(network, prefix, 'ipv6');
export function isPublicSnsAddress(ip: string): boolean {
  const family = isIP(ip);
  return family === 4
    ? !blocked.check(ip, 'ipv4')
    : family === 6 && global6.check(ip, 'ipv6') && !blocked.check(ip, 'ipv6');
}

/** Trusted HTTPS distribution is the signing-key trust boundary, as in AWS's JS validator.
 * Validate the endpoint's CA chain + hostname, pin its resolved public IP, no redirects.
 * The request body can never supply PEM or override this transport's trust store.
 */
@Injectable()
export class SnsCertificateFetcher {
  async fetch(url: URL): Promise<string> {
    let timer: NodeJS.Timeout | undefined;
    const deadline = Date.now() + 5_000;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new SesFeedbackError('SNS_CERTIFICATE_TIMEOUT', 503)),
          5_000,
        );
        timer.unref();
      }),
    ]).finally(() => clearTimeout(timer));
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicSnsAddress(address))
    )
      throw new SesFeedbackError('SNS_CERTIFICATE_DNS_DENIED', 403);
    const address = addresses[0]!;
    return new Promise((resolve, reject) => {
      let finished = false;
      const fail = (code: string, status: 403 | 503 = 503) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        request.destroy();
        reject(new SesFeedbackError(code, status));
      };
      const request = get(
        {
          hostname: address.address,
          family: address.family,
          servername: url.hostname,
          port: 443,
          path: url.pathname,
          method: 'GET',
          headers: { Host: url.hostname, Accept: 'application/x-pem-file' },
          agent: false,
          rejectUnauthorized: true,
          ca: [...rootCertificates],
          checkServerIdentity: (_host, cert) =>
            checkServerIdentity(url.hostname, cert),
        },
        (response) => {
          if (response.statusCode !== 200) {
            response.resume();
            fail('SNS_CERTIFICATE_UNAVAILABLE');
            return;
          }
          let size = 0;
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 64 * 1024) {
              fail('SNS_CERTIFICATE_TOO_LARGE', 403);
              return;
            }
            chunks.push(chunk);
          });
          response.on('end', () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            resolve(Buffer.concat(chunks).toString('utf8'));
          });
          response.on('error', () => fail('SNS_CERTIFICATE_TRANSPORT_ERROR'));
          response.on('aborted', () => fail('SNS_CERTIFICATE_TRANSPORT_ERROR'));
        },
      );
      request.on('error', () => fail('SNS_CERTIFICATE_TRANSPORT_ERROR'));
      timer = setTimeout(
        () => fail('SNS_CERTIFICATE_TIMEOUT'),
        Math.max(1, deadline - Date.now()),
      );
      timer.unref();
    });
  }
}
