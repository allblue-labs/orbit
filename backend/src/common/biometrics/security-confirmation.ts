import { Injectable } from '@nestjs/common';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ForbiddenException } from '../../exceptions';
import { AuthRateLimitService } from '../auth-rate-limit.service';
import {
  AuthChallengeStore,
  type ChallengePurpose,
} from './auth-challenge.store';

export const SECURITY_CONFIRMATION_HEADER = 'x-orbit-security-confirmation';
const actions = [
  'MFA_ENABLE',
  'MFA_DISABLE',
  'PASSKEY_REGISTER',
  'DEVICE_REGISTER',
  'BIOMETRIC_REVOKE',
] as const;
export type SecurityAction = (typeof actions)[number];
export type SecurityAudience = 'team' | 'portal';

export class SecurityConfirmationDto {
  @IsIn(actions)
  action!: SecurityAction;

  @IsString()
  @Length(1, 200)
  currentPassword!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  mfaCode?: string;
}

function purpose(audience: SecurityAudience): ChallengePurpose {
  return audience === 'team'
    ? 'USER_SECURITY_CONFIRMATION'
    : 'PORTAL_SECURITY_CONFIRMATION';
}

@Injectable()
export class SecurityConfirmation {
  constructor(
    private readonly challenges: AuthChallengeStore,
    private readonly limits: AuthRateLimitService,
  ) {}

  async issue(
    actor: {
      audience: SecurityAudience;
      userId: string;
      sessionId: string;
      origin: string;
    },
    input: SecurityConfirmationDto,
    verify: () => Promise<void>,
  ): Promise<{ confirmation: string }> {
    if (actor.audience === 'portal' && input.action.startsWith('MFA_'))
      throw new ForbiddenException('Esta ação não está disponível no portal.');
    await this.limits.check(
      `security-confirmation:${actor.audience}`,
      actor.origin,
      `user:${actor.userId}`,
    );
    await verify();
    const confirmation = await this.challenges.issue(
      purpose(actor.audience),
      actor.sessionId,
      input.action,
    );
    return { confirmation };
  }

  async consume(
    audience: SecurityAudience,
    sessionId: string,
    action: SecurityAction,
    confirmation?: string,
  ): Promise<void> {
    if (
      !confirmation ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(confirmation) ||
      !(await this.challenges.consume(
        confirmation,
        purpose(audience),
        sessionId,
        action,
      ))
    )
      throw new ForbiddenException(
        'Confirme sua identidade para concluir esta ação.',
        'SECURITY_CONFIRMATION_REQUIRED',
      );
  }
}
