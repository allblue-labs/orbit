import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  AiAgentQueryDto,
  AiExecutionQueryDto,
  CreateAiAgentDto,
  ExecuteAiAgentDto,
  UpdateAiAgentDto,
} from './ai.dto';
import { AiService } from './ai.service';
import { PlanCapability } from '../subscription-plans/catalog/plan-catalog.types';
import {
  ProductCapabilities,
  ProductFeature,
  RequiresProductFeature,
} from '../subscription-plans/product-access';

@ApiTags('AI')
@Controller()
@RequiresActivePlan()
@ProductCapabilities(
  PlanCapability.ORBIT_INTELLIGENCE,
  PlanCapability.AI_ASSISTANTS,
)
@RequiresProductFeature(
  ProductFeature.ORBIT_INTELLIGENCE,
  ProductFeature.AI_ASSISTANTS,
)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('ai-agents')
  @Capabilities('ai.agents.read')
  @Permissions('ai.agents.read')
  agents(@Req() req: IdentityRequest, @Query() query: AiAgentQueryDto) {
    return this.ai.listAgents(this.org(req), query);
  }

  @Get('ai-agents/:id')
  @Capabilities('ai.agents.read')
  @Permissions('ai.agents.read')
  agent(@Param('id', ParseUUIDv7Pipe) id: string, @Req() req: IdentityRequest) {
    return this.ai.getAgent(id, this.org(req));
  }

  @Post('ai-agents')
  @Capabilities('ai.agents.manage')
  @Permissions('ai.agents.create')
  createAgent(@Req() req: IdentityRequest, @Body() input: CreateAiAgentDto) {
    return this.ai.createAgent(this.org(req), input);
  }

  @Patch('ai-agents/:id')
  @Capabilities('ai.agents.manage')
  @Permissions('ai.agents.update')
  updateAgent(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() req: IdentityRequest,
    @Body() input: UpdateAiAgentDto,
  ) {
    return this.ai.updateAgent(id, this.org(req), input);
  }

  @Delete('ai-agents/:id')
  @Capabilities('ai.agents.manage')
  @Permissions('ai.agents.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAgent(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() req: IdentityRequest,
  ) {
    return this.ai.removeAgent(id, this.org(req));
  }

  @Post('ai-agents/:id/executions')
  @Capabilities('ai.executions.run')
  @Permissions('ai.executions.create')
  execute(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() req: IdentityRequest,
    @Body() input: ExecuteAiAgentDto,
  ) {
    return this.ai.execute(id, this.org(req), req.identity!.id, input);
  }

  @Get('ai-executions')
  @Capabilities('ai.executions.read')
  @Permissions('ai.executions.read')
  executions(@Req() req: IdentityRequest, @Query() query: AiExecutionQueryDto) {
    return this.ai.listExecutions(this.org(req), query);
  }

  @Get('ai-executions/:id')
  @Capabilities('ai.executions.read')
  @Permissions('ai.executions.read')
  execution(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() req: IdentityRequest,
  ) {
    return this.ai.getExecution(id, this.org(req));
  }

  @Post('ai-executions/:id/cancel')
  @Capabilities('ai.executions.run')
  @Permissions('ai.executions.cancel')
  cancel(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() req: IdentityRequest,
  ) {
    return this.ai.cancel(id, this.org(req));
  }

  private org(req: IdentityRequest) {
    if (!req.identity?.organizationId)
      throw new ForbiddenException('Organization context is required');
    return req.identity.organizationId;
  }
}
