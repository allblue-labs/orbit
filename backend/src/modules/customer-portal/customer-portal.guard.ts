import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { UUID } from '../../contracts';
import { UnauthorizedException } from '../../exceptions';
import { isJwtValidationError } from '../../errors';
import { CustomerPortalRepository } from './customer-portal.repository';
import { CustomerPortalTokenService } from './customer-portal-token.service';
import type { CustomerPortalActor } from './customer-portal.types';

export interface CustomerPortalRequest extends Request {
  portalActor?: CustomerPortalActor;
  actorType?: 'CUSTOMER_PORTAL';
  portalIdentityId?: UUID;
  organizationId?: UUID;
  customerId?: UUID;
}

@Injectable()
export class CustomerPortalGuard implements CanActivate {
  constructor(
    private readonly tokens: CustomerPortalTokenService,
    private readonly repository: CustomerPortalRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerPortalRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException();

    try {
      const claims = await this.tokens.verifyAccessToken(header.slice(7));
      if (
        claims.type !== 'portal_access' ||
        claims.actorType !== 'CUSTOMER_PORTAL'
      ) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      const session = await this.repository.resolveSession(
        claims.sid,
        claims.sub,
      );
      if (
        !session ||
        session.organizationId !== claims.organizationId ||
        session.customerId !== claims.customerId
      ) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      const actor: CustomerPortalActor = {
        actorType: 'CUSTOMER_PORTAL',
        identityId: this.tokens.asUuid(session.id),
        sessionId: this.tokens.asUuid(session.sessionId),
        organizationId: this.tokens.asUuid(session.organizationId),
        customerId: this.tokens.asUuid(session.customerId),
      };
      request.portalActor = actor;
      request.actorType = actor.actorType;
      request.portalIdentityId = actor.identityId;
      request.organizationId = actor.organizationId;
      request.customerId = actor.customerId;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      if (isJwtValidationError(error)) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
      throw error;
    }
  }
}
