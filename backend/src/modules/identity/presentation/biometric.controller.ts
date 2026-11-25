import { TenantRecovery } from '../../tenant-operations/tenant-operation.policy';
import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPublicErrors } from '../../../common/public-errors';
import { requestClientIp } from '../../../common/trusted-client-origin';
import {
  SECURITY_CONFIRMATION_HEADER,
  SecurityConfirmation,
} from '../../../common/biometrics/security-confirmation';
import {
  DeviceBiometricLoginDto,
  EnrollDeviceBiometricDto,
  WebAuthnAuthenticationDto,
  WebAuthnRegistrationDto,
} from '../../../common/biometrics';
import { Public, Surfaces } from '../../../decorators';
import { ParseUUIDv7Pipe } from '../../../pipes';
import { BiometricLoginService } from '../application/biometric-login.service';
import type { IdentityRequest } from '../infrastructure/jwt-authentication.guard';
import { IdentityReadModelMapper } from '../identity.mapper';

/** Entrar com a biometria. Público: a prova é a própria credencial. */
@ApiTags('Identity')
@ApiPublicErrors()
@Controller('identity/biometrics')
export class BiometricLoginController {
  constructor(
    private readonly biometrics: BiometricLoginService,
    private readonly readModels: IdentityReadModelMapper,
  ) {}

  @Public()
  @Post('webauthn/authentication/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  authenticationOptions() {
    return this.biometrics.authenticationOptions();
  }

  @Public()
  @Post('webauthn/authentication')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async authenticate(
    @Body() input: WebAuthnAuthenticationDto,
    @Req() request: IdentityRequest,
  ) {
    return this.readModels.session(
      await this.biometrics.authenticate(input, {
        client: input.client,
        userAgent: request.header('user-agent'),
        ipAddress: requestClientIp(request),
      }),
    );
  }

  @Public()
  @Post('devices/login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  async deviceLogin(
    @Body() input: DeviceBiometricLoginDto,
    @Req() request: IdentityRequest,
  ) {
    const result = await this.biometrics.deviceLogin(input, {
      client: input.client,
      deviceId: input.deviceId,
      userAgent: request.header('user-agent'),
      ipAddress: requestClientIp(request),
    });
    return {
      ...this.readModels.session(result),
      deviceSecret: result.deviceSecret,
    };
  }
}

/** As biometrias cadastradas pela própria pessoa. */
@ApiTags('Identity Profile')
@ApiPublicErrors()
@Controller('identity/me/biometrics')
@Surfaces('WEB', 'MOBILE', 'API')
export class BiometricProfileController {
  constructor(
    private readonly biometrics: BiometricLoginService,
    private readonly confirmation: SecurityConfirmation,
  ) {}

  @TenantRecovery('identity')
  @Get()
  list(@Req() request: IdentityRequest) {
    return this.biometrics.list(request.identity!.id);
  }

  @TenantRecovery('identity')
  @Post('webauthn/registration/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  registrationOptions(@Req() request: IdentityRequest) {
    return this.biometrics.registrationOptions(request.identity!.id);
  }

  @TenantRecovery('identity')
  @Post('webauthn/registration')
  async register(
    @Req() request: IdentityRequest,
    @Body() input: WebAuthnRegistrationDto,
  ) {
    await this.confirmation.consume(
      'team',
      request.identity!.sessionId,
      'PASSKEY_REGISTER',
      request.header(SECURITY_CONFIRMATION_HEADER),
    );
    return this.biometrics.register(
      request.identity!.id,
      input,
      request.header('user-agent'),
    );
  }

  @TenantRecovery('identity')
  @Post('devices')
  @Header('Cache-Control', 'no-store')
  async enrollDevice(
    @Req() request: IdentityRequest,
    @Body() input: EnrollDeviceBiometricDto,
  ) {
    await this.confirmation.consume(
      'team',
      request.identity!.sessionId,
      'DEVICE_REGISTER',
      request.header(SECURITY_CONFIRMATION_HEADER),
    );
    return this.biometrics.enrollDevice(
      request.identity!.id,
      input,
      request.header('user-agent'),
    );
  }

  @TenantRecovery('identity')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    await this.confirmation.consume(
      'team',
      request.identity!.sessionId,
      'BIOMETRIC_REVOKE',
      request.header(SECURITY_CONFIRMATION_HEADER),
    );
    return this.biometrics.revoke(request.identity!.id, id);
  }
}
