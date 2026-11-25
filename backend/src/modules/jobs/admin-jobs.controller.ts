import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Permissions, Roles } from '../../decorators';
import { TenantRecovery } from '../tenant-operations/tenant-operation.policy';
import {
  EmailFailureQuery,
  JobFailureQuery,
  RequeueBatch,
  RequeueInput,
} from './admin-jobs.dto';
import { AdminJobsService } from './admin-jobs.service';

enum EmailOutbox {
  Identity = 'identity',
  Contact = 'contact',
}

@Controller({ path: 'admin', version: '1' })
@Roles('PLATFORM_ADMIN')
@Permissions('platform.admin')
@TenantRecovery('platform')
export class AdminJobsController {
  constructor(private readonly admin: AdminJobsService) {}

  @Get('jobs')
  list(@Query() query: JobFailureQuery) {
    return this.admin.list(query);
  }

  @Post('jobs/requeue')
  @HttpCode(200)
  batch(@Body() input: RequeueBatch) {
    return this.admin.batch(input.items);
  }

  @Post('jobs/:id/requeue')
  @HttpCode(200)
  requeue(@Param('id', ParseUUIDPipe) id: string, @Body() input: RequeueInput) {
    return this.admin.requeue({ id, generation: input.generation });
  }

  @Get('email-outboxes')
  listEmail(@Query() query: EmailFailureQuery) {
    return this.admin.listEmail(query);
  }

  @Post('email-outboxes/:source/:id/requeue')
  @HttpCode(200)
  requeueEmail(
    @Param('source', new ParseEnumPipe(EmailOutbox)) source: EmailOutbox,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.requeueEmail(source, id);
  }
}
