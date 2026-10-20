import { Inject, Injectable } from '@nestjs/common';
import type {
  MobilePlatform,
  MobilePushPayloadReadModel,
  MobilePushProvider as ProviderName,
} from './mobile-device.read-models';

export type MobilePushResult =
  | { kind: 'ACCEPTED_BY_PROVIDER'; providerMessageId?: string }
  | { kind: 'INVALID_TOKEN'; code: string }
  | { kind: 'TEMPORARY_FAILURE'; code: string }
  | { kind: 'PERMANENT_FAILURE'; code: string };

export interface MobilePushTarget {
  platform: MobilePlatform;
  provider: ProviderName;
  token: string;
}

export interface MobilePushDeliveryProvider {
  readonly name: string;
  send(
    target: MobilePushTarget,
    payload: MobilePushPayloadReadModel,
  ): Promise<MobilePushResult>;
}

export const MOBILE_PUSH_PROVIDER = Symbol('MOBILE_PUSH_PROVIDER');

@Injectable()
export class DisabledMobilePushProvider implements MobilePushDeliveryProvider {
  readonly name = 'disabled';
  send(): Promise<MobilePushResult> {
    return Promise.resolve({
      kind: 'PERMANENT_FAILURE',
      code: 'PROVIDER_DISABLED',
    });
  }
}

@Injectable()
export class HttpGatewayMobilePushProvider implements MobilePushDeliveryProvider {
  readonly name = 'http-gateway';

  constructor(
    private readonly url: string,
    private readonly credential: string,
  ) {}

  async send(
    target: MobilePushTarget,
    payload: MobilePushPayloadReadModel,
  ): Promise<MobilePushResult> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.credential}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ target, payload }),
        signal: AbortSignal.timeout(10_000),
      });
      const result = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const code =
        typeof result.code === 'string'
          ? result.code
          : `HTTP_${response.status}`;
      if (response.ok)
        return {
          kind: 'ACCEPTED_BY_PROVIDER',
          providerMessageId:
            typeof result.messageId === 'string' ? result.messageId : undefined,
        };
      if (response.status === 404 || response.status === 410)
        return { kind: 'INVALID_TOKEN', code };
      if (
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500
      )
        return { kind: 'TEMPORARY_FAILURE', code };
      return { kind: 'PERMANENT_FAILURE', code };
    } catch {
      return { kind: 'TEMPORARY_FAILURE', code: 'PROVIDER_UNAVAILABLE' };
    }
  }
}

export function mobilePushProviderFactory(): MobilePushDeliveryProvider {
  const mode = (process.env.PUSH_PROVIDER ?? 'disabled').toLowerCase();
  if (mode === 'disabled') return new DisabledMobilePushProvider();
  if (mode !== 'gateway') throw new Error(`Unsupported PUSH_PROVIDER: ${mode}`);
  const url = process.env.PUSH_GATEWAY_URL;
  const credential = process.env.PUSH_GATEWAY_CREDENTIAL;
  if (!url || !credential)
    throw new Error(
      'PUSH_PROVIDER=gateway requires PUSH_GATEWAY_URL and PUSH_GATEWAY_CREDENTIAL',
    );
  return new HttpGatewayMobilePushProvider(url, credential);
}

@Injectable()
export class MobilePushProviderAccessor {
  constructor(
    @Inject(MOBILE_PUSH_PROVIDER)
    readonly provider: MobilePushDeliveryProvider,
  ) {}
}
