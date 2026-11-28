import { PASSWORD_RESET_TTL_MS } from '../identity/domain/password-reset.policy';
import { Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'node:crypto';
import { Prisma, type PlatformTenantProvisioning } from '@prisma/client';
import type { IHashProvider } from '../../contracts';
import type { PrismaTransactionClient } from '../../database/prisma.types';
import { RequestContextService } from '../../context';
import { VerifiedPlatformAuthority } from '../../common/verified-platform-authority';
import {
  ConflictException,
  EntityNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../exceptions';
import { SlugHelper } from '../../helpers';
import { HASH_PROVIDER, EnvironmentProvider } from '../../providers';
import { generateUuidV7, normalizeBrazilianDocument } from '../../utils';
import { RegistrationRepository } from '../identity/infrastructure/registration.repository';
import type { RegisterOrganizationDto } from '../identity/presentation/dto/identity.dto';
import { IdentityRepository } from '../identity/infrastructure/identity.repository';
import { IdentityTokenService } from '../identity/application/token.service';
import { EmailVerificationService } from '../identity/application/email-verification.service';
import { CommercialPlanService } from '../subscription-plans/catalog/commercial-plan.service';
import { SubscriptionProvisioningService } from '../subscription-plans/subscriptions/subscription-provisioning.service';
import { BillingInterval } from '../subscription-plans/catalog/plan-catalog.types';
import type {
  CreatePlatformTenantDto,
  PlatformListQueryDto,
  UpdatePlatformOrganizationDto,
} from './dto/platform-administration.dto';
import { authorizedCorporateReference } from '../corporate-administration/corporate-request';
import type { CorporateCall } from '../corporate-administration/corporate-access.guard';
import {
  ORGANIZATIONS_PROVISION,
  ORGANIZATIONS_PROVISIONING_READ,
  RECOVERY_PROVISIONING_RESUME,
} from '../corporate-administration/technical-credential.service';
import type { CorporateAuditReference } from './corporate-organization.read-model';
import { platformSubscription } from './platform-subscription.projection';
import { PlatformAdministrationRepository } from './platform-administration.repository';

const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');

type ProvisioningActor =
  | { actorUserId: string; corporate?: never }
  | { actorUserId?: never; corporate: CorporateAuditReference };
type ProvisioningReportAction =
  | 'PLATFORM_PROVISIONING_READ'
  | 'PLATFORM_TENANT_PROVISIONING_RESULT'
  | 'PLATFORM_TENANT_PROVISIONING_RESUME';

@Injectable()
export class PlatformAdministrationService {
  constructor(
    private readonly repository: PlatformAdministrationRepository,
    private readonly registration: RegistrationRepository,
    @Inject(HASH_PROVIDER) private readonly hashes: IHashProvider,
    private readonly verification: EmailVerificationService,
    private readonly subscriptions: SubscriptionProvisioningService,
    private readonly commercial: CommercialPlanService,
    private readonly identities: IdentityRepository,
    private readonly tokens: IdentityTokenService,
    private readonly contexts: RequestContextService,
    private readonly environment: EnvironmentProvider,
  ) {}

  private authority(actorId: string = this.contexts.get().userId!) {
    const context = this.contexts.get();
    const authority = VerifiedPlatformAuthority.forUser(
      context.platformAuthority,
      actorId,
    );
    if (
      context.actorType !== 'INTERNAL_USER' ||
      context.userId !== actorId ||
      !VerifiedPlatformAuthority.hasRole(
        authority,
        actorId,
        'PLATFORM_ADMIN',
      ) ||
      !(
        authority?.permissions.includes('*') ||
        authority?.permissions.includes('platform.admin')
      )
    )
      throw new ForbiddenException('Verified platform authority is required');
    return {
      actorId,
      metadata: {
        authoritySource: 'PLATFORM_ROLE_ASSIGNMENT',
        grantIds: [...authority.assignmentIds],
        correlationId: context.requestId,
      } satisfies Prisma.InputJsonObject,
    };
  }

  private audit(
    tx: PrismaTransactionClient,
    action: string,
    result: string,
    target?: { organizationId?: string | null; id?: string },
    detail?: Prisma.InputJsonObject,
    transition?: {
      before: Prisma.InputJsonObject;
      after: Prisma.InputJsonObject;
    },
  ) {
    const { actorId, metadata } = this.authority();
    return tx.auditLog.create({
      data: {
        organizationId: target?.organizationId,
        userId: actorId,
        action,
        entityType: 'PLATFORM_ADMINISTRATION',
        entityId: target?.id,
        requestId: this.contexts.get().requestId,
        before: transition?.before,
        after: transition?.after,
        metadata: { ...metadata, ...detail, result },
      },
    });
  }

  private async read<T>(
    action: string,
    work: () => Promise<T>,
    organizationId?: string,
  ) {
    this.authority();
    const result = await work();
    await this.repository.transaction((tx) =>
      this.audit(tx, action, 'CONFIRMED', {
        organizationId,
        id: organizationId,
      }),
    );
    return result;
  }
  overview() {
    return this.read('PLATFORM_OVERVIEW_READ', () =>
      this.repository.overview(),
    );
  }
  organizations(query: PlatformListQueryDto) {
    return this.read('PLATFORM_ORGANIZATIONS_READ', () =>
      this.repository.listOrganizations(query),
    );
  }
  users(query: PlatformListQueryDto) {
    return this.read('PLATFORM_USERS_READ', () =>
      this.repository.listUsers(query),
    );
  }
  resources() {
    return this.read('PLATFORM_RESOURCES_READ', () =>
      this.repository.plansAndModules(),
    );
  }
  async organization(id: string) {
    return this.read(
      'PLATFORM_ORGANIZATION_READ',
      async () => {
        const org = await this.repository.findOrganization(id);
        if (!org) throw new EntityNotFoundException('Organization', id);
        return org;
      },
      id,
    );
  }

  createTenant(
    actorId: string,
    input: CreatePlatformTenantDto,
    idempotencyKey?: string,
  ) {
    this.authority(actorId);
    return this.startProvisioning(
      { actorUserId: actorId },
      input,
      idempotencyKey,
    ).then((id) => this.provisioning(id));
  }

  createCorporateTenant(
    call: CorporateCall,
    reference: unknown,
    input: CreatePlatformTenantDto,
    key?: string,
  ) {
    const corporate = authorizedCorporateReference(
      call,
      reference,
      ORGANIZATIONS_PROVISION,
      true,
    );
    if (!key || input.owner.password !== undefined)
      throw new ValidationException(
        'Informe a chave de idempotência e use o link de configuração do proprietário.',
      );
    const actor = { corporate };
    return this.startProvisioning(actor, input, key).then((id) =>
      this.corporateProvisioningResult(
        actor,
        id,
        'PLATFORM_TENANT_PROVISIONING_RESULT',
      ),
    );
  }

  private async startProvisioning(
    actor: ProvisioningActor,
    input: CreatePlatformTenantDto,
    idempotencyKey?: string,
  ) {
    if (
      input.subscriptionStatus !== undefined ||
      input.currentPeriodEnd !== undefined ||
      input.externalCustomerId !== undefined ||
      input.externalSubscriptionId !== undefined ||
      !['ACTIVE', 'ONBOARDING'].includes(input.organizationStatus)
    ) {
      await this.provisionTransaction(actor, (tx) =>
        this.provisionAudit(
          actor,
          tx,
          'PLATFORM_TENANT_PROVISIONING_REJECTED',
          'REJECTED',
          undefined,
          { reason: 'ADMIN_FINANCIAL_OR_OPERATIONAL_FIELDS_READ_ONLY' },
        ),
      );
      throw new ValidationException(
        'Os campos financeiros são definidos pela contratação canônica; a política de suspensão não pode ser alterada neste fluxo.',
      );
    }
    if (!actor.corporate)
      await this.validateProvisioningPlan(actor, input.planKey);
    const normalized = {
      owner: {
        email: input.owner.email.trim().toLowerCase(),
        firstName: input.owner.firstName.trim(),
        lastName: input.owner.lastName.trim(),
        passwordFingerprint: input.owner.password
          ? createHmac('sha256', this.environment.get('ENCRYPTION_KEY'))
              .update(input.owner.password)
              .digest('hex')
          : null,
      },
      organizationName: input.organizationName.trim(),
      primarySegment: input.primarySegment.trim(),
      planKey: input.planKey,
      billingInterval: input.billingInterval ?? BillingInterval.MONTHLY,
      organizationStatus: input.organizationStatus,
      primaryBusinessUnit: {
        type: input.primaryBusinessUnit.type,
        legalName: input.primaryBusinessUnit.legalName.trim(),
        tradeName: input.primaryBusinessUnit.tradeName?.trim() ?? null,
        city: input.primaryBusinessUnit.city.trim(),
        street: input.primaryBusinessUnit.street.trim(),
        stateCode: input.primaryBusinessUnit.stateCode.toUpperCase(),
        documentType: input.primaryBusinessUnit.documentType,
        documentNumber: normalizeBrazilianDocument(
          input.primaryBusinessUnit.documentNumber,
        ),
      },
    };
    const slug = SlugHelper.create(normalized.organizationName);
    if (!slug)
      throw new ValidationException(
        'Informe um nome válido para a organização.',
      );
    const key =
      idempotencyKey ??
      `legacy:${normalized.owner.email}:${normalized.primaryBusinessUnit.documentNumber}`;
    if (
      idempotencyKey !== undefined &&
      !/^[a-zA-Z0-9._:-]{1,128}$/.test(idempotencyKey)
    )
      throw new ValidationException(
        'Informe uma chave de idempotência válida, com até 128 caracteres.',
      );
    const requestHash = digest(JSON.stringify(normalized));
    const keyHash = digest(key);
    const scope = actor.corporate
      ? { technicalPrincipalId: actor.corporate.technicalPrincipalId }
      : { actorUserId: actor.actorUserId };
    if (actor.corporate) {
      const existing = await this.provisionTransaction(actor, (tx) =>
        tx.platformTenantProvisioning.findFirst({
          where: { ...scope, idempotencyKey: keyHash },
        }),
      );
      if (
        !existing ||
        (existing.requestHash === requestHash && existing.status === 'RECEIVED')
      )
        await this.validateProvisioningPlan(actor, input.planKey);
    }
    const operation = await this.provisionTransaction(actor, async (tx) => {
      const inserted = await tx.platformTenantProvisioning.createMany({
        data: {
          id: generateUuidV7(),
          ...scope,
          idempotencyKey: keyHash,
          requestHash,
          correlationId:
            actor.corporate?.correlationId ?? this.contexts.get().requestId,
          planCode: input.planKey,
          billingInterval: normalized.billingInterval,
          ownerPasswordProvided: !!input.owner.password,
        },
        skipDuplicates: true,
      });
      const op = await tx.platformTenantProvisioning.findFirstOrThrow({
        where: { ...scope, idempotencyKey: keyHash },
      });
      if (op.requestHash !== requestHash)
        throw new ConflictException(
          'Esta chave já identifica outra solicitação de provisionamento.',
          actor.corporate ? 'IDEMPOTENCY_MISMATCH' : 'CONFLICT',
        );
      if (inserted.count === 1)
        await this.provisionAudit(
          actor,
          tx,
          'PLATFORM_TENANT_PROVISIONING',
          'RECEIVED',
          { id: op.id },
          { planCode: op.planCode },
          {
            before: { stage: 'NOT_REGISTERED' },
            after: { stage: 'RECEIVED' },
          },
        );
      return op;
    }).catch(async (error) => {
      await this.provisionTransaction(actor, (tx) =>
        this.provisionAudit(
          actor,
          tx,
          'PLATFORM_TENANT_PROVISIONING_REJECTED',
          'REJECTED',
          undefined,
          { reason: 'REQUEST_REJECTED', idempotencyFingerprint: digest(key) },
        ),
      );
      throw error;
    });
    const passwordHash =
      operation.status === 'RECEIVED'
        ? await this.hashes.hash(
            input.owner.password ?? this.tokens.generateOpaqueToken(),
          )
        : null;
    try {
      await this.locked(actor, operation.id, async (tx, op) => {
        if (op.status !== 'RECEIVED') return;
        const registration: RegisterOrganizationDto = {
          email: normalized.owner.email,
          firstName: normalized.owner.firstName,
          lastName: normalized.owner.lastName,
          password: '',
          organizationName: normalized.organizationName,
          primarySegment: normalized.primarySegment,
          planKey: input.planKey,
          billingInterval: normalized.billingInterval,
          legalName: input.primaryBusinessUnit.legalName,
          documentType: input.primaryBusinessUnit.documentType,
          documentNumber: normalized.primaryBusinessUnit.documentNumber,
          city: input.primaryBusinessUnit.city,
          street: input.primaryBusinessUnit.street,
          stateCode: input.primaryBusinessUnit.stateCode,
          businessUnitType: input.primaryBusinessUnit.type,
          client: 'WEB',
        };
        const created = await this.registration.register(
          registration,
          passwordHash!,
          slug,
          {
            publicSignup: true,
            actorUserId: actor.actorUserId,
            platformAdmin: !actor.corporate,
            deferOwnerEmailProvenance: !!actor.corporate,
            organizationStatus: input.organizationStatus,
          },
          undefined,
          undefined,
          tx,
        );
        if (!created)
          throw new ValidationException(
            'Plano indisponível para provisionamento.',
          );
        await tx.platformTenantProvisioning.update({
          where: { id: op.id },
          data: {
            status: 'TENANT_CREATED',
            organizationId: created.organizationId,
            ownerUserId: created.userId,
            primaryBusinessUnitId: created.businessUnitId,
            version: { increment: 1 },
            lastErrorCode: null,
          },
        });
        await this.provisionAudit(
          actor,
          tx,
          'PLATFORM_TENANT_PROVISIONING',
          'TENANT_CREATED',
          { organizationId: created.organizationId, id: op.id },
          { planCode: op.planCode },
          {
            before: { stage: 'RECEIVED' },
            after: {
              stage: 'TENANT_CREATED',
              organizationId: created.organizationId,
            },
          },
        );
      });
    } catch (error) {
      await this.failure(actor, operation.id, 'TENANT_CREATION_FAILED');
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException(
          'E-mail, organização ou documento já cadastrado.',
        );
      throw error;
    }
    await this.resumeStages(actor, operation.id);
    return operation.id;
  }

  private locked<T>(
    actor: ProvisioningActor,
    id: string,
    work: (
      tx: PrismaTransactionClient,
      op: PlatformTenantProvisioning,
    ) => Promise<T>,
  ) {
    return this.provisionTransaction(actor, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`platform-provision:${id}`}, 0))`;
      const op = await tx.platformTenantProvisioning.findUnique({
        where: {
          id,
          ...(actor.corporate ? {} : { technicalPrincipalId: null }),
        },
      });
      if (!op) throw new EntityNotFoundException('Tenant provisioning', id);
      await this.bindProvisioningTenant(actor, tx, op);
      return work(tx, op);
    });
  }

  private failure(actor: ProvisioningActor, id: string, code: string) {
    return this.locked(actor, id, async (tx, op) => {
      if (op.status === 'COMPLETED') return;
      await tx.platformTenantProvisioning.update({
        where: { id },
        data: {
          lastErrorCode: code,
          attempts: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await this.provisionAudit(
        actor,
        tx,
        'PLATFORM_TENANT_PROVISIONING',
        'PENDING',
        op,
        {
          reason: code,
          stage: op.status,
        },
      );
    });
  }

  async resumeProvisioning(id: string) {
    const { actorId } = this.authority();
    const actor = { actorUserId: actorId };
    await this.resumeStages(actor, id);
    return this.provisioning(id);
  }

  async resumeCorporateProvisioning(
    call: CorporateCall,
    reference: unknown,
    id: string,
    capability:
      | typeof ORGANIZATIONS_PROVISION
      | typeof RECOVERY_PROVISIONING_RESUME = ORGANIZATIONS_PROVISION,
  ) {
    const actor = {
      corporate: authorizedCorporateReference(
        call,
        reference,
        capability,
        true,
      ),
    };
    try {
      await this.resumeStages(actor, id);
    } catch (error) {
      if (!(error instanceof EntityNotFoundException)) throw error;
    }
    return this.corporateProvisioningResult(
      actor,
      id,
      'PLATFORM_TENANT_PROVISIONING_RESUME',
    );
  }

  getCorporateProvisioning(
    call: CorporateCall,
    reference: unknown,
    id: string,
  ) {
    const actor = {
      corporate: authorizedCorporateReference(
        call,
        reference,
        ORGANIZATIONS_PROVISIONING_READ,
        false,
      ),
    };
    return this.corporateProvisioningResult(actor, id);
  }

  private async resumeStages(actor: ProvisioningActor, id: string) {
    try {
      await this.locked(actor, id, async (tx, op) => {
        if (op.status !== 'TENANT_CREATED') return;
        const unit = await tx.businessUnit.findFirstOrThrow({
          where: {
            id: op.primaryBusinessUnitId!,
            organizationId: op.organizationId!,
            deletedAt: null,
            isPrimary: true,
          },
        });
        const subscription = await this.subscriptions.provisionIn(tx, {
          organizationId: op.organizationId!,
          planKey: op.planCode,
          billingInterval: op.billingInterval,
          legalDocument: unit.documentNumber,
        });
        await tx.platformTenantProvisioning.update({
          where: { id },
          data: {
            status: 'SUBSCRIPTION_READY',
            lastErrorCode: null,
            version: { increment: 1 },
          },
        });
        await this.provisionAudit(
          actor,
          tx,
          'PLATFORM_TENANT_PROVISIONING',
          'SUBSCRIPTION_READY',
          op,
          {
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            version: subscription.version,
          },
          {
            before: { stage: op.status },
            after: {
              stage: 'SUBSCRIPTION_READY',
              subscriptionId: subscription.id,
              subscriptionStatus: subscription.status,
            },
          },
        );
      });
    } catch (error) {
      if (error instanceof EntityNotFoundException) throw error;
      await this.failure(actor, id, 'CANONICAL_PROVISIONING_PENDING');
      return;
    }
    try {
      await this.locked(actor, id, async (tx, op) => {
        if (op.status !== 'SUBSCRIPTION_READY') return;
        // Canonical provisioning is positive provenance for this initial owner, never for team members.
        await tx.$queryRaw`SELECT app_register_account_email_owner(${op.ownerUserId!}::uuid,${op.organizationId!}::uuid)::text`;
        if (actor.corporate)
          await tx.$queryRaw`SELECT set_config('app.user_id', ${op.ownerUserId!}, true)`;
        const owner = await tx.user.findUniqueOrThrow({
          where: { id: op.ownerUserId! },
          select: { id: true, email: true },
        });
        let tokenId: string | undefined;
        if (op.ownerPasswordProvided)
          await this.verification.queueWelcomeIn(tx, owner.id, owner.email);
        else {
          const token = this.tokens.generateOpaqueToken();
          const reset = await this.identities.createPasswordReset(
            owner.id,
            this.tokens.hashOpaqueToken(token),
            new Date(Date.now() + PASSWORD_RESET_TTL_MS),
            token,
            tx,
          );
          tokenId = reset.id;
          if (
            actor.corporate &&
            !(await this.deliveryStatus(tx, op.id, reset.id))
          )
            throw new Error('OWNER_SETUP_NOT_QUEUED');
        }
        await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.actorUserId ?? ''}, true)`;
        await tx.platformTenantProvisioning.update({
          where: { id },
          data: {
            status: 'COMPLETED',
            ownerSetupTokenId: tokenId,
            completedAt: new Date(),
            lastErrorCode: null,
            version: { increment: 1 },
          },
        });
        await this.provisionAudit(
          actor,
          tx,
          'PLATFORM_TENANT_PROVISIONING',
          'CONFIRMED',
          op,
          {
            ownerSetup: op.ownerPasswordProvided
              ? 'DIRECT_PASSWORD_DEPRECATED'
              : 'SETUP_LINK_QUEUED',
            deliveryConfirmed: false,
          },
          {
            before: { stage: op.status },
            after: {
              stage: 'COMPLETED',
              ownerSetupQueued: !op.ownerPasswordProvided,
            },
          },
        );
      });
    } catch {
      await this.failure(actor, id, 'OWNER_SETUP_PENDING');
    }
  }

  async provisioning(id: string) {
    return this.read('PLATFORM_PROVISIONING_READ', async () => {
      const op = await this.repository.transaction((tx) =>
        tx.platformTenantProvisioning.findUnique({
          where: { id, technicalPrincipalId: null },
        }),
      );
      if (!op) throw new EntityNotFoundException('Tenant provisioning', id);
      if (!op.organizationId)
        return {
          id: null,
          provisioning: {
            id: op.id,
            status: op.status,
            complete: false,
            lastErrorCode: op.lastErrorCode,
            nextAction:
              op.status === 'RECEIVED'
                ? 'RESUBMIT_ORIGINAL_REQUEST'
                : 'CONTACT_SUPPORT',
            correlationId: op.correlationId,
          },
        };
      return this.organization(op.organizationId);
    });
  }

  private async validateProvisioningPlan(
    actor: ProvisioningActor,
    planKey: string,
  ) {
    const planOffer = await this.commercial.find(planKey);
    if (!planOffer?.isActive || planOffer.tenantId !== null) {
      await this.provisionTransaction(actor, (tx) =>
        this.provisionAudit(
          actor,
          tx,
          'PLATFORM_TENANT_PROVISIONING_REJECTED',
          'REJECTED',
          undefined,
          { reason: 'INVALID_COMMERCIAL_PLAN' },
        ),
      );
      throw new ValidationException(
        'Selecione um plano válido do catálogo comercial.',
      );
    }
  }

  private provisionTransaction<T>(
    actor: ProvisioningActor,
    work: (tx: PrismaTransactionClient) => Promise<T>,
  ) {
    return this.repository.transaction(async (tx) => {
      if (actor.corporate)
        await tx.$queryRaw`SELECT set_config('app.corporate_provisioner', ${actor.corporate.technicalPrincipalId}, true)`;
      return work(tx);
    });
  }

  private async bindProvisioningTenant(
    actor: ProvisioningActor,
    tx: PrismaTransactionClient,
    op: PlatformTenantProvisioning,
  ) {
    if (!actor.corporate || !op.organizationId) return;
    // The tenant and unit are loaded from the RLS-filtered workflow, never supplied by Nexus.
    await tx.$queryRaw`SELECT
      set_config('app.organization_id', ${op.organizationId}, true),
      set_config('app.business_unit_id', ${op.primaryBusinessUnitId ?? ''}, true),
      set_config('app.business_unit_ids', ${op.primaryBusinessUnitId ?? ''}, true)`;
  }

  private async provisionAudit(
    actor: ProvisioningActor,
    tx: PrismaTransactionClient,
    action: string,
    result: string,
    target?: { organizationId?: string | null; id?: string },
    detail?: Prisma.InputJsonObject,
    transition?: {
      before: Prisma.InputJsonObject;
      after: Prisma.InputJsonObject;
    },
  ) {
    if (!actor.corporate) {
      await this.audit(tx, action, result, target, detail, transition);
      return;
    }
    const {
      correlationId,
      technicalPrincipalId,
      declaredNexusAdministratorId,
    } = actor.corporate;
    await tx.auditLog.createMany({
      data: {
        id: generateUuidV7(),
        organizationId: target?.organizationId,
        action,
        entityType: 'PLATFORM_ADMINISTRATION',
        entityId: target?.id,
        requestId: correlationId,
        before: transition?.before,
        after: transition?.after,
        metadata: {
          ...detail,
          result,
          correlationId,
          technicalPrincipalId,
          declaredNexusAdministratorId,
          authoritySource: 'CORPORATE_TECHNICAL_PRINCIPAL',
        },
      },
    });
  }

  private async deliveryStatus(
    tx: PrismaTransactionClient,
    id: string,
    resetId: string,
  ) {
    const [row] = await tx.$queryRaw<[{ status: string | null }]>`
      SELECT public.app_corporate_owner_setup_delivery(${id}::uuid, ${resetId}::uuid) AS status`;
    return row.status;
  }

  private async corporateProvisioningResult(
    actor: ProvisioningActor,
    id: string,
    action: ProvisioningReportAction = 'PLATFORM_PROVISIONING_READ',
  ) {
    const result = await this.provisionTransaction(actor, async (tx) => {
      const op = await tx.platformTenantProvisioning.findUnique({
        where: { id },
      });
      if (!op) {
        await this.provisionAudit(actor, tx, action, 'NOT_FOUND', { id });
        return null;
      }
      await this.bindProvisioningTenant(actor, tx, op);
      const org = op.organizationId
        ? await tx.organization.findFirst({
            where: { id: op.organizationId, deletedAt: null },
            select: { id: true, status: true, updatedAt: true },
          })
        : null;
      const canonical = org
        ? (await this.repository.canonical(tx, [org.id])).get(org.id)
        : undefined;
      const projected = platformSubscription(canonical, new Date());
      const delivery = op.ownerSetupTokenId
        ? await this.deliveryStatus(tx, op.id, op.ownerSetupTokenId)
        : null;
      await this.provisionAudit(
        actor,
        tx,
        action,
        op.status === 'COMPLETED' ? 'CONFIRMED' : 'PENDING',
        op,
        { stage: op.status },
      );
      return {
        id: op.id,
        status: op.status,
        complete: op.status === 'COMPLETED',
        version: op.version,
        attempts: op.attempts,
        lastErrorCode: op.lastErrorCode,
        nextAction:
          op.status === 'RECEIVED'
            ? 'RESUBMIT_ORIGINAL_REQUEST'
            : op.status === 'COMPLETED'
              ? null
              : 'RESUME',
        requestedPlanCode: op.planCode,
        requestedBillingInterval: op.billingInterval,
        createdAt: op.createdAt,
        updatedAt: op.updatedAt,
        completedAt: op.completedAt,
        organization: org,
        subscription: canonical
          ? {
              planCode: canonical.planCode,
              status: canonical.status,
              effectivePlanCode: projected.planCode,
              effectiveStatus: projected.status,
              accessGranted: projected.accessGranted,
              trialStartsAt: canonical.trialStartsAt,
              trialEndsAt: canonical.trialEndsAt,
            }
          : null,
        ownerSetup:
          op.status !== 'COMPLETED'
            ? 'NOT_QUEUED'
            : delivery === 'PENDING' || delivery === 'RUNNING'
              ? 'QUEUED'
              : (delivery ?? 'NOT_OBSERVED'),
      };
    });
    if (!result) throw new EntityNotFoundException('Tenant provisioning', id);
    return result;
  }

  async updateOrganization(
    id: string,
    actorId: string,
    input: UpdatePlatformOrganizationDto,
  ) {
    const { metadata } = this.authority(actorId);
    try {
      const updated = await this.repository.updateOrganization(
        id,
        actorId,
        input,
        metadata,
      );
      if (!updated) throw new EntityNotFoundException('Organization', id);
      return this.organization(id);
    } catch (error) {
      const reason =
        error instanceof Error && error.message.startsWith('ADMIN_')
          ? error.message
          : 'ADMIN_UPDATE_FAILED';
      await this.repository.transaction((tx) =>
        this.audit(
          tx,
          'PLATFORM_ORGANIZATION_UPDATE_REJECTED',
          'REJECTED',
          {
            id,
            organizationId:
              error instanceof EntityNotFoundException ? undefined : id,
          },
          { reason },
        ),
      );
      if (reason === 'ADMIN_VERSION_CONFLICT')
        throw new ConflictException(
          'Os dados foram alterados. Atualize a página antes de continuar.',
        );
      if (reason.startsWith('ADMIN_') && reason !== 'ADMIN_UPDATE_FAILED')
        throw new ValidationException(
          'Somente nome e segmento podem ser alterados, com updatedAt atual. Plano, assinatura e períodos devem seguir os fluxos canônicos do cliente.',
        );
      throw error;
    }
  }
}
