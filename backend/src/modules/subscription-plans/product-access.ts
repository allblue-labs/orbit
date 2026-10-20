import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RequestContext, RequestContextStorage } from '../../context';
import { generateUuidV7 } from '../../utils';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  PlanCapability,
  type PlanCapability as PlanCapabilityCode,
} from './catalog/plan-catalog.types';
import { EntitlementService } from './entitlements/entitlement.service';

export const ProductFeature = {
  ORBIT_INTELLIGENCE: 'ORBIT_INTELLIGENCE',
  AI_ASSISTANTS: 'AI_ASSISTANTS',
  SCHEDULING_INTELLIGENCE: 'SCHEDULING_INTELLIGENCE',
} as const;
export type ProductFeature =
  (typeof ProductFeature)[keyof typeof ProductFeature];

/** Implementation state, independent from what a tenant purchased. */
const FEATURE_AVAILABILITY: Readonly<Record<ProductFeature, boolean>> = {
  [ProductFeature.ORBIT_INTELLIGENCE]: true,
  [ProductFeature.AI_ASSISTANTS]: true,
  // The existing endpoint explicitly returns mocked recommendations.
  [ProductFeature.SCHEDULING_INTELLIGENCE]: false,
};

@Injectable()
export class ProductAccessService {
  constructor(private readonly entitlements: EntitlementService) {}

  isAvailable(feature: ProductFeature): boolean {
    return FEATURE_AVAILABILITY[feature];
  }

  async canUse(
    organizationId: string,
    capability: PlanCapabilityCode,
    feature?: ProductFeature,
  ): Promise<boolean> {
    return (
      (feature === undefined || this.isAvailable(feature)) &&
      (await this.entitlements.hasCapability(organizationId, capability))
    );
  }

  async assertCapability(
    organizationId: string,
    capability: PlanCapabilityCode,
  ): Promise<void> {
    await this.entitlements.assertCapability(organizationId, capability);
  }

  async describe(organizationId: string) {
    const effective = await this.entitlements.resolve(organizationId);
    return {
      capabilities: effective.accessGranted
        ? Object.values(PlanCapability).filter((capability) =>
            effective.capabilities.has(capability),
          )
        : [],
      featureAvailability: { ...FEATURE_AVAILABILITY },
    };
  }
}

const PRODUCT_CAPABILITIES = 'orbit:product-capabilities';
const PRODUCT_FEATURES = 'orbit:product-features';

export const ProductCapabilities = (...values: PlanCapabilityCode[]) =>
  SetMetadata(PRODUCT_CAPABILITIES, values);
export const RequiresProductFeature = (...values: ProductFeature[]) =>
  SetMetadata(PRODUCT_FEATURES, values);

abstract class ProductMetadataGuard {
  constructor(
    protected readonly reflector: Reflector,
    protected readonly access: ProductAccessService,
  ) {}

  protected organizationId(context: ExecutionContext): string | null {
    return (
      context.switchToHttp().getRequest<IdentityRequest>().identity
        ?.organizationId ?? null
    );
  }
}

@Injectable()
export class ProductCapabilityGuard
  extends ProductMetadataGuard
  implements CanActivate
{
  constructor(
    reflector: Reflector,
    access: ProductAccessService,
    private readonly contexts: RequestContextStorage,
  ) {
    super(reflector, access);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<readonly PlanCapabilityCode[]>(
        PRODUCT_CAPABILITIES,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (required.length === 0) return true;
    const organizationId = this.organizationId(context);
    if (!organizationId)
      throw new ForbiddenException('Organization context is required');
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const identity = request.identity!;
    const authorize = async () => {
      for (const capability of required) {
        await this.access.assertCapability(organizationId, capability);
      }
      return true;
    };

    // Guards execute before interceptors in Nest. Canonical entitlements use
    // RLS, so this short-lived context is established from the authenticated
    // identity before querying. The regular request interceptor still owns
    // the context used by controllers and services afterwards.
    return this.contexts.run(
      new RequestContext({
        requestId: generateUuidV7(),
        actorType: 'INTERNAL_USER',
        userId: identity.id,
        organizationId: identity.organizationId!,
        businessUnitId: identity.businessUnitId,
        businessUnitIds: identity.businessUnitIds,
        roles: identity.roles,
        permissions: identity.permissions,
        allowedSurfaces: identity.allowedSurfaces,
        isOrganizationOwner: identity.isOrganizationOwner,
        ip: request.ip ?? null,
        userAgent: request.header('user-agent') ?? null,
        locale: request.acceptsLanguages()[0] ?? 'pt-BR',
      }),
      authorize,
    );
  }
}

@Injectable()
export class ProductFeatureGuard
  extends ProductMetadataGuard
  implements CanActivate
{
  constructor(reflector: Reflector, access: ProductAccessService) {
    super(reflector, access);
  }

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<readonly ProductFeature[]>(
        PRODUCT_FEATURES,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    if (required.every((feature) => this.access.isAvailable(feature))) {
      return true;
    }
    throw new ForbiddenException(
      'Feature is not available in this product release',
      'FEATURE_NOT_AVAILABLE',
    );
  }
}
