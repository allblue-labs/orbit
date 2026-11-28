import { Injectable, Logger } from '@nestjs/common';
import https from 'node:https';
import { isIP } from 'node:net';
import { checkServerIdentity, rootCertificates } from 'node:tls';
import { InfrastructureException } from '../exceptions';
import { sameAddress } from './outbound-address';
import { OutboundDenied, OutboundPolicy } from './outbound-policy';
import type { OutboundPurpose } from './outbound.config';

export interface OutboundRequest {
  headers: Record<string, string>;
  body: Buffer;
  timeoutMs?: number;
}
export interface OutboundResponse {
  status: number;
  headers: import('node:http').IncomingHttpHeaders;
  body: Buffer;
}

/** No fetch/global agent, redirects, proxy env, cookie jar, decompression or retry.
 * Authorization happens on every operation; credentials are sent only after the
 * pinned IP, CA chain, hostname and remote peer have passed their checks.
 */
@Injectable()
export class OutboundHttp {
  private readonly logger = new Logger(OutboundHttp.name);
  private active = 0;
  constructor(private readonly policy: OutboundPolicy) {}
  url(purpose: OutboundPurpose, value: string) {
    return this.policy.url(purpose, value);
  }

  async request(
    purpose: OutboundPurpose,
    value: string,
    input: OutboundRequest,
  ): Promise<OutboundResponse> {
    if (this.active >= 16 || input.body.length > 2 * 1024 * 1024)
      throw this.failure();
    const maximum = purpose === 'AI' ? 120000 : 15000;
    const timeout = input.timeoutMs ?? maximum;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > maximum)
      throw this.failure();
    const deadline = Date.now() + timeout;
    this.active++;
    try {
      const { url, address } = await this.policy.authorize(
        purpose,
        value,
        Math.min(timeout, 5000),
      );
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw this.failure();
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const limit = purpose === 'AI' ? 1024 * 1024 : 64 * 1024;
      return await new Promise<OutboundResponse>((resolve, reject) => {
        let finished = false;
        const finish = (error?: Error, result?: OutboundResponse) => {
          if (finished) return;
          finished = true;
          clearTimeout(totalTimer);
          clearTimeout(connectTimer);
          req.destroy();
          if (error) reject(error);
          else resolve(result!);
        };
        const req = https.request(
          {
            hostname: address.address,
            family: address.family,
            port: Number(url.port || 443),
            servername: isIP(hostname) ? undefined : hostname,
            path: url.pathname + url.search,
            method: 'POST',
            agent: false,
            rejectUnauthorized: true,
            ca: [...rootCertificates],
            checkServerIdentity: (_host, cert) =>
              checkServerIdentity(hostname, cert),
            maxHeaderSize: 16 * 1024,
            headers: {
              ...input.headers,
              Host: url.host,
              'Content-Length': String(input.body.length),
              'Accept-Encoding': 'identity',
              Connection: 'close',
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            const encoding = res.headers['content-encoding'];
            const length = Number(res.headers['content-length']);
            if (
              status < 200 ||
              status >= 300 ||
              (encoding && encoding !== 'identity') ||
              length > limit
            ) {
              res.destroy();
              finish(this.failure());
              return;
            }
            let bytes = 0;
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => {
              bytes += chunk.length;
              if (bytes > limit) {
                res.destroy();
                finish(this.failure());
                return;
              }
              chunks.push(chunk);
            });
            res.on('error', () => finish(this.failure()));
            res.on('aborted', () => finish(this.failure()));
            res.on('end', () =>
              finish(undefined, {
                status,
                headers: res.headers,
                body: Buffer.concat(chunks),
              }),
            );
          },
        );
        req.on('error', () => finish(this.failure()));
        req.on('socket', (socket) =>
          socket.once('secureConnect', () => {
            clearTimeout(connectTimer);
            if (
              !socket.remoteAddress ||
              !sameAddress(address.address, socket.remoteAddress)
            ) {
              finish(this.failure());
              return;
            }
            // Never write auth headers/body before TLS and peer verification.
            req.end(input.body);
          }),
        );
        req.setTimeout(Math.min(30000, remaining), () =>
          finish(this.failure()),
        );
        const totalTimer = setTimeout(() => finish(this.failure()), remaining);
        const connectTimer = setTimeout(
          () => finish(this.failure()),
          Math.min(5000, remaining),
        );
        totalTimer.unref();
        connectTimer.unref();
      });
    } catch (error) {
      this.logger.warn({
        stage: 'outbound-http-rejected',
        purpose,
        reason:
          error instanceof OutboundDenied ? error.reason : 'TRANSPORT_FAILED',
      });
      if (error instanceof OutboundDenied) throw error;
      throw this.failure();
    } finally {
      this.active--;
    }
  }
  private failure() {
    return new InfrastructureException(
      'Não foi possível concluir a comunicação com o provedor externo.',
    );
  }
}
