import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EnvironmentProvider } from '../../providers';
import { AuthenticationService } from './application/authentication.service';
import { InvitationService } from './application/invitation.service';
import { InvitationReadModels } from './presentation/invitation.read-models';
import { MfaService } from './application/mfa.service';
import { PasswordRecoveryService } from './application/password-recovery.service';
import { ProfileService } from './application/profile.service';
import { RegistrationService } from './application/registration.service';
import { IdentityTokenService } from './application/token.service';
import { IDENTITY_TOKEN_DELIVERY } from './domain/identity.types';
import { IdentityRepository } from './infrastructure/identity.repository';
import { RegistrationRepository } from './infrastructure/registration.repository';
import {
  NoopIdentityTokenDelivery,
  SmtpIdentityTokenDelivery,
} from './infrastructure/identity-token.delivery';
import { IdentityReadModelMapper } from './identity.mapper';
import { AuthController } from './presentation/auth.controller';
import { InvitationController } from './presentation/invitation.controller';
import { ProfileController } from './presentation/profile.controller';
import { AvatarService } from './application/avatar.service';
import { AvatarRepository } from './infrastructure/avatar.repository';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [EnvironmentProvider],
      useFactory: (environment: EnvironmentProvider) => ({
        secret:
          process.env.NODE_ENV === 'test'
            ? (environment.getOptional('JWT_ACCESS_SECRET') ??
              'test-only-jwt-secret-at-least-32-bytes')
            : environment.get('JWT_ACCESS_SECRET'),
        signOptions: {
          issuer: environment.getOptional('JWT_ISSUER') ?? 'orbit-api',
          audience: environment.getOptional('JWT_AUDIENCE') ?? 'orbit',
        },
        verifyOptions: {
          issuer: environment.getOptional('JWT_ISSUER') ?? 'orbit-api',
          audience: environment.getOptional('JWT_AUDIENCE') ?? 'orbit',
        },
      }),
    }),
  ],
  controllers: [AuthController, ProfileController, InvitationController],
  providers: [
    IdentityRepository,
    RegistrationRepository,
    IdentityTokenService,
    AuthenticationService,
    PasswordRecoveryService,
    InvitationService,
    InvitationReadModels,
    ProfileService,
    AvatarService,
    AvatarRepository,
    MfaService,
    RegistrationService,
    IdentityReadModelMapper,
    NoopIdentityTokenDelivery,
    SmtpIdentityTokenDelivery,
    {
      provide: IDENTITY_TOKEN_DELIVERY,
      inject: [NoopIdentityTokenDelivery, SmtpIdentityTokenDelivery],
      useFactory: (
        noop: NoopIdentityTokenDelivery,
        smtp: SmtpIdentityTokenDelivery,
      ) => (process.env.NODE_ENV === 'production' ? smtp : noop),
    },
  ],
  exports: [
    IdentityTokenService,
    IdentityRepository,
    RegistrationRepository,
    /** A equipe entrega o mesmo link por e-mail quando há SMTP. */
    IDENTITY_TOKEN_DELIVERY,
  ],
})
export class IdentityModule {}
