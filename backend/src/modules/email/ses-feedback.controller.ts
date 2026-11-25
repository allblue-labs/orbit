import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  Logger,
  Post,
} from '@nestjs/common';
import { Public } from '../../decorators';
import { SesFeedbackService } from './ses-feedback.service';
import { SesFeedbackError } from './ses-feedback.types';

/** Public to sessions; authenticity comes exclusively from the SNS signature/trust checks. */
@Public()
@Controller({ path: 'email/webhooks', version: '1' })
export class SesFeedbackController {
  private readonly logger = new Logger(SesFeedbackController.name);
  constructor(private readonly service: SesFeedbackService) {}
  @Post('ses-sns')
  @HttpCode(200)
  async receive(@Body() body: unknown) {
    try {
      await this.service.receive(body);
      return { received: true };
    } catch (error) {
      const known = error instanceof SesFeedbackError;
      const code = known ? error.code : 'SNS_FEEDBACK_TRANSIENT';
      const status = known ? error.status : 503;
      this.logger.warn(
        JSON.stringify({ event: 'ses_feedback_rejected', code, status }),
      );
      // Only fixed messages cross the HTTP/filter boundary; never a provider/ORM error.
      throw new HttpException(
        status === 503
          ? 'Não foi possível processar a notificação agora.'
          : 'Não foi possível validar a notificação.',
        status,
      );
    }
  }
}
