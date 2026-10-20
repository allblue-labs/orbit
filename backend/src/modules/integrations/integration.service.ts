import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ICryptoProvider, JSONObject } from '../../contracts';
import { ConflictException, EntityNotFoundException } from '../../exceptions';
import { CRYPTO_PROVIDER, ENVIRONMENT_PROVIDER } from '../../providers';
import type { IEnvironmentProvider } from '../../contracts';
import type {
  CreateIntegrationDto,
  UpdateIntegrationDto,
} from './dto/integration.dto';
import { IntegrationRepository } from './integration.repository';
import { IntegrationProviderRegistry } from './provider/integration-provider';

@Injectable()
export class IntegrationService {
  constructor(
    private readonly repository: IntegrationRepository,
    private readonly providers: IntegrationProviderRegistry,
    @Inject(CRYPTO_PROVIDER) private readonly crypto: ICryptoProvider,
    @Inject(ENVIRONMENT_PROVIDER)
    private readonly environment: IEnvironmentProvider,
  ) {}

  list(organizationId: string) {
    return this.repository.list(organizationId);
  }

  get(id: string, organizationId: string) {
    return this.requirePublic(id, organizationId);
  }

  async create(organizationId: string, input: CreateIntegrationDto) {
    try {
      return await this.repository.create({
        organizationId,
        provider: input.provider,
        category: input.category,
        displayName: input.displayName,
        status: 'PENDING_VALIDATION',
        configuration: (input.configuration ?? {}) as Prisma.InputJsonValue,
        encryptedSecrets: this.encryptSecrets(input.secrets),
        secretKeyVersion: input.secrets ? this.keyVersion() : null,
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async update(
    id: string,
    organizationId: string,
    input: UpdateIntegrationDto,
  ) {
    const current = await this.repository.findInternal(id, organizationId);
    if (!current) throw new EntityNotFoundException('Integration', id);
    const providerChanged =
      input.provider !== undefined && input.provider !== current.provider;
    try {
      return await this.repository.update(id, {
        provider: input.provider,
        category: input.category,
        displayName: input.displayName,
        configuration: input.configuration as Prisma.InputJsonValue | undefined,
        encryptedSecrets:
          input.clearSecrets || providerChanged
            ? null
            : input.secrets
              ? this.encryptSecrets(input.secrets)
              : undefined,
        secretKeyVersion:
          input.clearSecrets || providerChanged
            ? null
            : input.secrets
              ? this.keyVersion()
              : undefined,
        status: 'PENDING_VALIDATION',
        lastError: null,
      });
    } catch (error) {
      this.rethrowConflict(error);
    }
  }

  async validate(id: string, organizationId: string) {
    const integration = await this.repository.findInternal(id, organizationId);
    if (!integration) throw new EntityNotFoundException('Integration', id);
    try {
      const adapter = this.providers.get(integration.provider);
      await adapter.validate(
        this.asObject(integration.configuration),
        this.decryptSecrets(integration.encryptedSecrets),
      );
      return await this.repository.update(id, {
        status: 'ACTIVE',
        lastValidatedAt: new Date(),
        lastError: null,
      });
    } catch (error) {
      await this.repository.update(id, {
        status: 'ERROR',
        lastValidatedAt: new Date(),
        lastError: 'PROVIDER_VALIDATION_FAILED',
      });
      throw error;
    }
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.requirePublic(id, organizationId);
    await this.repository.softDelete(id);
  }

  private encryptSecrets(
    secrets: Record<string, unknown> | undefined,
  ): Uint8Array<ArrayBuffer> | null {
    if (!secrets) return null;
    return new TextEncoder().encode(
      this.crypto.encrypt(JSON.stringify(secrets)),
    );
  }

  private decryptSecrets(
    value: Uint8Array<ArrayBuffer> | null,
  ): JSONObject | null {
    if (!value) return null;
    const parsed: unknown = JSON.parse(
      this.crypto.decrypt(new TextDecoder().decode(value)),
    );
    return this.asObject(parsed);
  }

  private asObject(value: unknown): JSONObject {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value as JSONObject;
  }

  private keyVersion(): number {
    return Number(this.environment.getOptional('ENCRYPTION_KEY_VERSION') ?? 1);
  }

  private async requirePublic(id: string, organizationId: string) {
    const integration = await this.repository.findPublic(id, organizationId);
    if (!integration) throw new EntityNotFoundException('Integration', id);
    return integration;
  }

  private rethrowConflict(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Integration already exists');
    }
    throw error;
  }
}
