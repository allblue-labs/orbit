import { OutboundHttp } from '../../network/outbound-http';
import { Injectable } from '@nestjs/common';
import type { JSONObject } from '../../contracts';
import { ValidationException } from '../../exceptions';

export type AiProviderRequest = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  context: JSONObject;
  configuration: JSONObject;
  integrationConfiguration: JSONObject;
  secrets: JSONObject;
};

export type AiProviderResult = {
  output: JSONObject;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  providerRequestId?: string;
};

export interface AiProviderAdapter {
  readonly provider: string;
  execute(request: AiProviderRequest): Promise<AiProviderResult>;
}

@Injectable()
export class OpenAiCompatibleProvider implements AiProviderAdapter {
  readonly provider = 'OPENAI_COMPATIBLE';
  constructor(private readonly http: OutboundHttp) {}

  async execute(request: AiProviderRequest): Promise<AiProviderResult> {
    const baseUrl = this.http.url(
      'AI',
      this.string(
        request.integrationConfiguration.baseUrl,
        'Integration baseUrl',
      ),
    );
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, '')}/chat/completions`;
    const apiKey = this.string(request.secrets.apiKey, 'Integration apiKey');
    const timeoutMs = this.number(
      request.configuration.timeoutMs,
      60_000,
      1_000,
      120_000,
    );
    const temperature = this.number(
      request.configuration.temperature,
      0.2,
      0,
      2,
    );
    const response = await this.http.request('AI', baseUrl.toString(), {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: Buffer.from(
        JSON.stringify({
          model: request.model,
          temperature,
          messages: [
            { role: 'system', content: request.systemPrompt },
            {
              role: 'user',
              content: `${request.userPrompt}\n\nContexto autorizado:\n${JSON.stringify(request.context)}`,
            },
          ],
          response_format:
            request.configuration.jsonOutput === true
              ? { type: 'json_object' }
              : undefined,
        }),
      ),
      timeoutMs,
    });
    let raw: unknown;
    try {
      raw = JSON.parse(response.body.toString('utf8'));
    } catch {
      throw new Error('AI provider returned an invalid response');
    }
    const parsed = this.response(raw);
    return {
      output: {
        content: parsed.content,
        ...(parsed.finishReason ? { finishReason: parsed.finishReason } : {}),
      },
      model: parsed.model ?? request.model,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      providerRequestId: parsed.id,
    };
  }

  private response(raw: unknown) {
    if (!raw || typeof raw !== 'object')
      throw new Error('AI provider returned an invalid response');
    const body = raw as Record<string, unknown>;
    const choices = Array.isArray(body.choices) ? body.choices : [];
    const first =
      choices[0] && typeof choices[0] === 'object'
        ? (choices[0] as Record<string, unknown>)
        : {};
    const message =
      first.message && typeof first.message === 'object'
        ? (first.message as Record<string, unknown>)
        : {};
    if (typeof message.content !== 'string')
      throw new Error('AI provider response has no text content');
    const usage =
      body.usage && typeof body.usage === 'object'
        ? (body.usage as Record<string, unknown>)
        : {};
    return {
      id: typeof body.id === 'string' ? body.id : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      content: message.content,
      finishReason:
        typeof first.finish_reason === 'string'
          ? first.finish_reason
          : undefined,
      inputTokens:
        typeof usage.prompt_tokens === 'number'
          ? usage.prompt_tokens
          : undefined,
      outputTokens:
        typeof usage.completion_tokens === 'number'
          ? usage.completion_tokens
          : undefined,
    };
  }

  private string(value: unknown, label: string) {
    if (typeof value !== 'string' || !value)
      throw new ValidationException(`${label} is required`);
    return value;
  }

  private number(value: unknown, fallback: number, min: number, max: number) {
    if (value === undefined) return fallback;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < min ||
      value > max
    )
      throw new ValidationException(
        `AI numeric configuration must be between ${min} and ${max}`,
      );
    return value;
  }
}

@Injectable()
export class AiProviderRegistry {
  constructor(private readonly openAiCompatible: OpenAiCompatibleProvider) {}

  get(provider: string): AiProviderAdapter {
    if (provider === this.openAiCompatible.provider)
      return this.openAiCompatible;
    throw new ValidationException(`Unsupported AI provider: ${provider}`);
  }
}
