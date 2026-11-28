import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';
import { Public } from '../../../decorators';
import { EmailVerificationService } from '../application/email-verification.service';

export class ConfirmEmailDto {
  @ApiProperty()
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{64}$/)
  token!: string;
}
export class RequestEmailVerificationDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

@ApiTags('Identity')
@Controller('identity/email')
export class EmailVerificationController {
  constructor(private readonly verification: EmailVerificationService) {}

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  confirm(@Body() input: ConfirmEmailDto) {
    return this.verification.confirm(input.token);
  }

  @Public()
  @Post('resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resend(@Body() input: RequestEmailVerificationDto) {
    await this.verification.request(input.email);
    return {
      message:
        'Se houver uma conta aguardando confirmação, enviaremos as instruções por e-mail.',
    };
  }
}
