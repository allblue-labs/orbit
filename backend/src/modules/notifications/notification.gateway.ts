import { ForbiddenException } from '../../exceptions';
import { TenantOperationPolicy } from '../tenant-operations/tenant-operation.policy';
import { toAuthenticatedIdentity } from '../identity/application/authentication.service';
import { allowsSurface } from '../identity/domain/surface-access';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { IdentityTokenService } from '../identity/application/token.service';
import { IdentityRepository } from '../identity/infrastructure/identity.repository';

type AuthenticatedSocket = Socket & {
  data: NotificationSocketData;
};
type NotificationSocketData = {
  userId?: string;
  organizationId?: string;
  sessionId?: string;
};

@WebSocketGateway({
  namespace: '/notifications',
  cors: { origin: process.env.FRONTEND_ORIGIN ?? false, credentials: true },
  transports: ['websocket'],
})
export class NotificationGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly tokens: IdentityTokenService,
    private readonly identities: IdentityRepository,
    private readonly operational: TenantOperationPolicy,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    try {
      const token = this.bearer(client);
      const claims = await this.tokens.verifyAccessToken(token);
      const session = await this.identities.findSessionById(claims.sid);
      if (
        !session ||
        session.userId !== claims.sub ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now()
      ) {
        throw new Error('Invalid session');
      }
      const user = await this.identities.findById(claims.sub);
      if (
        !user ||
        user.status !== 'ACTIVE' ||
        user.deletedAt ||
        !allowsSurface(user, session.client)
      )
        throw new Error('Invalid identity');
      const identity = toAuthenticatedIdentity(user, claims.sid);
      if (!identity.organizationId) throw new Error('Organization required');
      await this.operational.assertCapabilityTenant(identity.organizationId);
      const data = client.data as unknown as NotificationSocketData;
      data.userId = identity.id;
      data.organizationId = identity.organizationId;
      data.sessionId = claims.sid;
      await client.join(
        `organization:${identity.organizationId}:user:${identity.id}`,
      );
      client.emit('notifications:ready', { connected: true });
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    client.removeAllListeners();
  }

  async emitToUser(
    userId: string,
    event: string,
    payload: unknown,
    organizationId: string,
  ): Promise<boolean> {
    try {
      // Recheck at every delivery: sockets established before suspension cannot keep receiving tenant data.
      await this.operational.assertCapabilityTenant(organizationId);
    } catch (error) {
      if (
        error instanceof ForbiddenException &&
        ['ORGANIZATION_SUSPENDED', 'ORGANIZATION_UNAVAILABLE'].includes(
          error.code,
        )
      )
        return false;
      throw error;
    }
    this.server
      .to(`organization:${organizationId}:user:${userId}`)
      .emit(event, payload);
    return true;
  }

  private bearer(client: Socket): string {
    const handshakeAuth = client.handshake.auth as unknown;
    const authToken =
      typeof handshakeAuth === 'object' &&
      handshakeAuth !== null &&
      'token' in handshakeAuth
        ? handshakeAuth.token
        : undefined;
    const header = client.handshake.headers.authorization;
    const value =
      typeof authToken === 'string'
        ? authToken
        : typeof header === 'string' && header.startsWith('Bearer ')
          ? header.slice(7)
          : '';
    if (!value) throw new Error('Missing access token');
    return value;
  }
}
