import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiPublicErrors } from '../../../common/public-errors';
import { Public, Surfaces } from '../../../decorators';
import { AuthenticationService } from '../application/authentication.service';
import { PasswordRecoveryService } from '../application/password-recovery.service';
import { RegistrationService } from '../application/registration.service';
import type { IdentityRequest } from '../infrastructure/jwt-authentication.guard';
import { IdentityReadModelMapper } from '../identity.mapper';
import {
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshTokenDto,
  RegisterOrganizationDto,
  ResetPasswordDto,
} from './dto/identity.dto';

@ApiTags('Identity')
@ApiPublicErrors()
@Controller('identity')
export class AuthController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly recovery: PasswordRecoveryService,
    private readonly registration: RegistrationService,
    private readonly readModels: IdentityReadModelMapper,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() input: RegisterOrganizationDto,
    @Req() request: IdentityRequest,
  ) {
    const session = await this.registration.register(input, {
      client: input.client,
      deviceId: input.deviceId,
      userAgent: request.header('user-agent'),
      ipAddress: request.ip,
    });
    return this.readModels.session(session);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() input: LoginDto, @Req() request: IdentityRequest) {
    const session = await this.authentication.login(
      input.email,
      input.password,
      input.mfaCode,
      {
        client: input.client,
        deviceId: input.deviceId,
        userAgent: request.header('user-agent'),
        ipAddress: request.ip,
      },
    );
    return this.readModels.session(session);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() input: RefreshTokenDto) {
    return this.readModels.session(
      await this.authentication.refresh(input.refreshToken),
    );
  }

  @Post('logout')
  @Surfaces('WEB', 'MOBILE', 'API')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@Body() input: LogoutDto, @Req() request: IdentityRequest) {
    return this.authentication.logout(
      request.identity?.sessionId,
      input.refreshToken,
    );
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(@Body() input: ForgotPasswordDto) {
    await this.recovery.request(input.email);
    return {
      message: 'If the account exists, recovery instructions were sent',
    };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  resetPassword(@Body() input: ResetPasswordDto) {
    return this.recovery.reset(input.token, input.password);
  }
}
