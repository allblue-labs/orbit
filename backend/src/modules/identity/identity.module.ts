import { Module } from '@nestjs/common';
import { IdentityEmailOutbox } from './infrastructure/identity-email.outbox';
import { IdentityEmailWorker } from './infrastructure/identity-email.worker';
import { EmailModule } from '../email/email.module';
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
import { TransactionalIdentityTokenDelivery } from './infrastructure/identity-token.delivery';
import { IdentityReadModelMapper } from './identity.mapper';
import { AuthController } from './presentation/auth.controller';
import { InvitationController } from './presentation/invitation.controller';
import { ProfileController } from './presentation/profile.controller';
import { AvatarService } from './application/avatar.service';
import { AvatarRepository } from './infrastructure/avatar.repository';
import { EmailVerificationService } from './application/email-verification.service';
import { EmailVerificationController } from './presentation/email-verification.controller';

@Module({
  imports: [
    EmailModule,
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
  controllers: [
    AuthController,
    ProfileController,
    InvitationController,
    EmailVerificationController,
  ],
  providers: [
    IdentityRepository,
    IdentityEmailOutbox,
    IdentityEmailWorker,
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
    EmailVerificationService,
    IdentityReadModelMapper,
    TransactionalIdentityTokenDelivery,
    {
      provide: IDENTITY_TOKEN_DELIVERY,
      useExisting: TransactionalIdentityTokenDelivery,
    },
  ],
  exports: [
    IdentityTokenService,
    EmailVerificationService,
    IdentityRepository,
    RegistrationRepository,
    /** A equipe entrega o mesmo link pelo transporte de e-mail configurado. */
    IDENTITY_TOKEN_DELIVERY,
  ],
})
export class IdentityModule {}
