import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiPublicErrors } from '../../common/public-errors';
import { Public } from '../../decorators';
import { UnauthorizedException } from '../../exceptions';
import {
  ActivatePortalInvitationDto,
  ChangePortalPasswordDto,
  ConfirmPortalPasswordResetDto,
  PortalLoginDto,
  PortalRefreshDto,
  RequestPortalPasswordResetDto,
} from './customer-portal.dto';
import {
  CustomerPortalMeReadModel,
  CustomerPortalSessionReadModel,
  PortalMessageReadModel,
} from './customer-portal.read-models';
import {
  CustomerPortalGuard,
  type CustomerPortalRequest,
} from './customer-portal.guard';
import { CustomerPortalService } from './customer-portal.service';
import {
  CustomerPortalMeSchema,
  CustomerPortalSessionSchema,
  PortalMessageSchema,
} from './customer-portal.openapi';

const metadata = (request: CustomerPortalRequest) => ({
  ipAddress: request.ip,
  userAgent: request.header('user-agent'),
});

@Public()
@ApiPublicErrors()
@ApiTags('Customer Portal Authentication')
@Controller({ path: 'portal/auth', version: '1' })
export class CustomerPortalAuthController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: PortalLoginDto })
  @ApiOkResponse({ type: CustomerPortalSessionSchema })
  login(
    @Body() input: PortalLoginDto,
    @Req() request: CustomerPortalRequest,
  ): Promise<CustomerPortalSessionReadModel> {
    return this.portal.login(input, metadata(request));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBody({ type: PortalRefreshDto })
  @ApiOkResponse({ type: CustomerPortalSessionSchema })
  refresh(
    @Body() input: PortalRefreshDto,
  ): Promise<CustomerPortalSessionReadModel> {
    return this.portal.refresh(input.refreshToken);
  }

  @Post('activate')
  @ApiBody({ type: ActivatePortalInvitationDto })
  @ApiCreatedResponse({ type: CustomerPortalSessionSchema })
  activate(
    @Body() input: ActivatePortalInvitationDto,
    @Req() request: CustomerPortalRequest,
  ): Promise<CustomerPortalSessionReadModel> {
    return this.portal.activate(input, metadata(request));
  }

  @Post('password/reset-request')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiBody({ type: RequestPortalPasswordResetDto })
  @ApiAcceptedResponse({ type: PortalMessageSchema })
  async resetRequest(
    @Body() input: RequestPortalPasswordResetDto,
    @Req() request: CustomerPortalRequest,
  ): Promise<PortalMessageReadModel> {
    await this.portal.requestPasswordReset(input, metadata(request));
    return {
      message: 'If the account exists, recovery instructions were sent',
    };
  }

  @Post('password/reset-confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBody({ type: ConfirmPortalPasswordResetDto })
  @ApiNoContentResponse()
  resetConfirm(
    @Body() input: ConfirmPortalPasswordResetDto,
    @Req() request: CustomerPortalRequest,
  ) {
    return this.portal.confirmPasswordReset(input, metadata(request));
  }

  @Post('logout')
  @UseGuards(CustomerPortalGuard)
  @ApiBearerAuth('customer-portal')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  logout(@Req() request: CustomerPortalRequest) {
    if (!request.portalActor) throw new UnauthorizedException();
    return this.portal.logout(request.portalActor);
  }

  @Patch('password')
  @UseGuards(CustomerPortalGuard)
  @ApiBearerAuth('customer-portal')
  @ApiBody({ type: ChangePortalPasswordDto })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  changePassword(
    @Req() request: CustomerPortalRequest,
    @Body() input: ChangePortalPasswordDto,
  ) {
    if (!request.portalActor) throw new UnauthorizedException();
    return this.portal.changePassword(request.portalActor, input);
  }
}

@Public()
@ApiPublicErrors()
@UseGuards(CustomerPortalGuard)
@ApiBearerAuth('customer-portal')
@ApiTags('Customer Portal')
@Controller({ path: 'portal', version: '1' })
export class CustomerPortalController {
  constructor(private readonly portal: CustomerPortalService) {}

  @Get('me')
  @ApiOkResponse({ type: CustomerPortalMeSchema })
  me(
    @Req() request: CustomerPortalRequest,
  ): Promise<CustomerPortalMeReadModel> {
    if (!request.portalActor) throw new UnauthorizedException();
    return this.portal.me(request.portalActor);
  }
}
