import {
  Body,
  Controller,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { Request } from 'express';
import { Public } from '../../decorators';
import {
  ValidationException,
  ServiceUnavailableException,
} from '../../exceptions';
import { requestClientIp } from '../../common/trusted-client-origin';
import {
  EMAIL_CONFIGURATION,
  type EmailConfiguration,
} from '../email/email.config';
import { PublicContactDto } from './public-contact.dto';
import { PublicContactRepository } from './public-contact.repository';
@Controller('public/contact')
export class PublicContactController {
  constructor(
    private readonly repository: PublicContactRepository,
    @Inject(EMAIL_CONFIGURATION) private readonly config: EmailConfiguration,
  ) {}
  @Public()
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @Header('Cache-Control', 'no-store')
  async submit(
    @Body() input: PublicContactDto,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: Request,
  ) {
    if (
      (process.env.PUBLIC_CONTACT_ENABLED ?? 'true').trim() !== 'true' ||
      !this.config.supportInbox
    )
      throw new ServiceUnavailableException(
        'O formulário está temporariamente indisponível. Tente novamente mais tarde.',
        'PUBLIC_CONTACT_UNAVAILABLE',
      );
    if (!key || !isUUID(key, '4'))
      throw new ValidationException(
        'Recarregue o formulário e tente enviar novamente.',
      );
    if (!input.website?.trim())
      await this.repository.enqueue(
        input,
        key,
        requestClientIp(request),
        this.config.supportInbox,
      );
    return {
      message: 'Mensagem recebida. Ela será encaminhada para o time do Orbit.',
    };
  }
}
