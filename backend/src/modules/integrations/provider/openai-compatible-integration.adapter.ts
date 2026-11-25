import { OutboundPolicy } from '../../../network/outbound-policy';
import { Injectable } from '@nestjs/common';
import type { JSONObject } from '../../../contracts';
import { ValidationException } from '../../../exceptions';
import type { IntegrationAdapter } from './integration-provider';

@Injectable()
export class OpenAiCompatibleIntegrationAdapter implements IntegrationAdapter {
  readonly provider = 'OPENAI_COMPATIBLE';
  constructor(private readonly outbound: OutboundPolicy) {}

  async validate(configuration: JSONObject, secrets: JSONObject | null) {
    const baseUrl = configuration.baseUrl;
    if (typeof baseUrl !== 'string')
      throw new ValidationException('AI integration baseUrl is required');
    if (typeof secrets?.apiKey !== 'string' || secrets.apiKey.length < 8)
      throw new ValidationException('AI integration apiKey is required');
    await this.outbound.authorize('AI', baseUrl);
  }
}
