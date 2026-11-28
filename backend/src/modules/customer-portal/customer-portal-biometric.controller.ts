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
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import {
  DeviceBiometricLoginDto,
  DeviceBiometricOptionsDto,
  EnrollDeviceBiometricDto,
  WebAuthnAuthenticationDto,
  WebAuthnRegistrationDto,
  deviceBiometricRefused,
} from '../../common/biometrics';
import { ApiPublicErrors } from '../../common/public-errors';
import { requestClientIp } from '../../common/trusted-client-origin';
import {
  SECURITY_CONFIRMATION_HEADER,
  SecurityConfirmation,
  SecurityConfirmationDto,
} from '../../common/biometrics/security-confirmation';
import { Public } from '../../decorators';
import { UnauthorizedException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import { CustomerPortalBiometricService } from './customer-portal-biometric.service';
import { CustomerPortalService } from './customer-portal.service';
import {
  CustomerPortalGuard,
  type CustomerPortalRequest,
} from './customer-portal.guard';

const metadata = (request: CustomerPortalRequest) => ({
  ipAddress: requestClientIp(request),
  userAgent: request.header('user-agent'),
});

/** O cliente entra com a biometria. Público: a prova é a credencial. */
@Public()
@ApiPublicErrors()
@ApiTags('Customer Portal Authentication')
@Controller({ path: 'portal/auth/biometrics', version: '1' })
export class CustomerPortalBiometricLoginController {
  constructor(private readonly biometrics: CustomerPortalBiometricService) {}

  @Post('webauthn/authentication/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Desafio para entrar com a biometria na web' })
  authenticationOptions() {
    return this.biometrics.authenticationOptions();
  }

  @Post('webauthn/authentication')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Entra com a biometria na web' })
  authenticate(
    @Body() input: WebAuthnAuthenticationDto,
    @Req() request: CustomerPortalRequest,
  ) {
    return this.biometrics.authenticate(input, metadata(request));
  }

  @Post('devices/login')
  @Header('Cache-Control', 'no-store')
  retiredDeviceLogin(): never {
    throw deviceBiometricRefused();
  }

  @Post('devices/authentication/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Desafio para entrar com a biometria do app' })
  deviceLoginOptions(@Body() input: DeviceBiometricOptionsDto) {
    return this.biometrics.deviceLoginOptions(input.credentialId);
  }

  @Post('devices/authentication')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Entra com a biometria do app' })
  deviceLogin(
    @Body() input: DeviceBiometricLoginDto,
    @Req() request: CustomerPortalRequest,
  ) {
    return this.biometrics.deviceLogin(input, metadata(request));
  }
}

/** As biometrias do próprio cliente. */
@Public()
@ApiPublicErrors()
@UseGuards(CustomerPortalGuard)
@ApiBearerAuth('customer-portal')
@ApiTags('Customer Portal Profile')
@ApiUnauthorizedResponse({ description: 'Sessão Portal inválida ou expirada' })
@Controller({ path: 'portal/me/biometrics', version: '1' })
export class CustomerPortalBiometricController {
  constructor(
    private readonly biometrics: CustomerPortalBiometricService,
    private readonly portal: CustomerPortalService,
    private readonly confirmation: SecurityConfirmation,
  ) {}

  @Post('confirmation')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  confirmSecurityChange(
    @Req() request: CustomerPortalRequest,
    @Body() input: SecurityConfirmationDto,
  ) {
    const identity = actor(request);
    return this.confirmation.issue(
      {
        audience: 'portal',
        userId: identity.identityId,
        sessionId: identity.sessionId,
        origin: requestClientIp(request),
      },
      input,
      () => this.portal.confirmSecurityChange(identity, input.currentPassword),
    );
  }

  @Get()
  @ApiOperation({ summary: 'Biometrias cadastradas pelo cliente' })
  list(@Req() request: CustomerPortalRequest) {
    return this.biometrics.list(actor(request));
  }

  @Post('webauthn/registration/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Desafio para cadastrar a biometria na web' })
  registrationOptions(@Req() request: CustomerPortalRequest) {
    return this.biometrics.registrationOptions(actor(request));
  }

  @Post('webauthn/registration')
  @ApiOperation({ summary: 'Cadastra a biometria deste navegador' })
  async register(
    @Req() request: CustomerPortalRequest,
    @Body() input: WebAuthnRegistrationDto,
  ) {
    await this.confirmation.consume(
      'portal',
      actor(request).sessionId,
      'PASSKEY_REGISTER',
      request.header(SECURITY_CONFIRMATION_HEADER),
    );
    return this.biometrics.register(
      actor(request),
      input,
      request.header('user-agent'),
    );
  }

  @Post('devices')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Cadastra a biometria deste aparelho (app)' })
  async enrollDevice(
    @Req() request: CustomerPortalRequest,
    @Body() input: EnrollDeviceBiometricDto,
  ) {
    await this.confirmation.consume(
      'portal',
      actor(request).sessionId,
      'DEVICE_REGISTER',
      request.header(SECURITY_CONFIRMATION_HEADER),
    );
    return this.biometrics.enrollDevice(
      actor(request),
      input,
      request.header('user-agent'),
    );
  }

  @Post('devices/options')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Desafio para cadastrar a biometria do app' })
  deviceEnrollmentOptions(@Req() request: CustomerPortalRequest) {
    return this.biometrics.deviceEnrollmentOptions(actor(request));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove uma biometria' })
  async revoke(
    @Req() request: CustomerPortalRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
  ) {
    await this.confirmation.consume(
      'portal',
      actor(request).sessionId,
      'BIOMETRIC_REVOKE',
      request.header(SECURITY_CONFIRMATION_HEADER),
    );
    return this.biometrics.revoke(actor(request), id);
  }
}

function actor(request: CustomerPortalRequest) {
  if (!request.portalActor) throw new UnauthorizedException();
  return request.portalActor;
}
