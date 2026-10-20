import { Injectable } from '@nestjs/common';
import { EntityNotFoundException, ForbiddenException } from '../../exceptions';
import type { AuthenticatedIdentity } from '../identity/domain/identity.types';
import type { DashboardQueryDto } from './dto/dashboard.dto';
import { DashboardRepository } from './dashboard.repository';
import { WidgetFactory } from './widget-factory';
import { WidgetRegistry } from './widget-registry';
import { WidgetResolver } from './widget-resolver';
import {
  ProductAccessService,
  ProductFeature,
} from '../subscription-plans/product-access';
import { PlanCapability } from '../subscription-plans/catalog/plan-catalog.types';

@Injectable()
export class DashboardService {
  constructor(
    private readonly repository: DashboardRepository,
    private readonly registry: WidgetRegistry,
    private readonly resolver: WidgetResolver,
    private readonly factory: WidgetFactory,
    private readonly productAccess: ProductAccessService,
  ) {}

  async get(identity: AuthenticatedIdentity, query: DashboardQueryDto) {
    const context = await this.context(identity);
    const definitions = this.resolver.resolve(
      await this.productDefinitions(
        identity.organizationId!,
        this.registry.all(),
      ),
      {
        ...context,
        permissions: identity.permissions,
        tags: query.tags,
      },
    );
    return {
      context: {
        organizationId: context.organizationId,
        organizationName: context.organizationName,
        segment: this.resolver.normalizeSegment(context.segment),
        plan: context.planKey,
        modules: context.modules,
        range: query.range,
      },
      layout: {
        version: 1,
        widgets: await Promise.all(
          definitions.map((definition) =>
            this.factory.create(
              definition,
              query.range,
              context.organizationId,
            ),
          ),
        ),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async getWidget(
    id: string,
    identity: AuthenticatedIdentity,
    query: DashboardQueryDto,
  ) {
    const context = await this.context(identity);
    const [definition] = await this.productDefinitions(
      identity.organizationId!,
      [this.registry.get(id)],
    );
    if (!definition)
      throw new ForbiddenException(
        'Widget is not available for the current product access',
      );
    const [available] = this.resolver.resolve([definition], {
      ...context,
      permissions: identity.permissions,
      tags: query.tags,
    });
    if (!available)
      throw new ForbiddenException(
        'Widget is not available for the current dashboard context',
      );
    return this.factory.create(available, query.range, context.organizationId);
  }

  private async context(identity: AuthenticatedIdentity) {
    if (!identity.organizationId)
      throw new ForbiddenException('Organization context is required');
    const context = await this.repository.context(identity.organizationId);
    if (!context) throw new EntityNotFoundException('Organization');
    return context;
  }

  private async productDefinitions<T extends { id: string }>(
    organizationId: string,
    definitions: readonly T[],
  ): Promise<readonly T[]> {
    if (
      !definitions.some(
        (definition) =>
          definition.id === 'orbit-intelligence' ||
          definition.id === 'attention-center',
      )
    )
      return definitions;
    const intelligence = await this.productAccess.canUse(
      organizationId,
      PlanCapability.ORBIT_INTELLIGENCE,
      ProductFeature.ORBIT_INTELLIGENCE,
    );
    return intelligence
      ? definitions
      : definitions.filter(
          (definition) =>
            definition.id !== 'orbit-intelligence' &&
            definition.id !== 'attention-center',
        );
  }
}
