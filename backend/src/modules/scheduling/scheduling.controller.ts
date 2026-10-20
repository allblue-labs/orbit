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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiOkResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  AddAllocationDto,
  AgendaQueryDto,
  AvailabilityQueryDto,
  CalendarQueryDto,
  CreateAvailabilityDto,
  CreateCalendarDto,
  CreateEventDto,
  EventQueryDto,
  UpdateCalendarDto,
  UpdateEventDto,
} from './dto/scheduling.dto';
import { SchedulingService } from './scheduling.service';
import { PlanCapability } from '../subscription-plans/catalog/plan-catalog.types';
import {
  ProductCapabilities,
  ProductFeature,
  RequiresProductFeature,
} from '../subscription-plans/product-access';

@ApiTags('Scheduling Engine')
@ApiBearerAuth()
@Controller('scheduling')
@RequiresActivePlan()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('calendars')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  @ApiOperation({ summary: 'List calendars available to the tenant context' })
  calendars(@Req() request: IdentityRequest, @Query() query: CalendarQueryDto) {
    return this.scheduling.listCalendars(
      this.org(request),
      query.businessUnitId,
    );
  }

  @Post('calendars')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.calendars.create')
  createCalendar(
    @Req() request: IdentityRequest,
    @Body() input: CreateCalendarDto,
  ) {
    return this.scheduling.createCalendar(this.org(request), input);
  }

  @Get('calendars/:id')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  calendar(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.scheduling.getCalendar(id, this.org(request));
  }

  @Patch('calendars/:id')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.calendars.update')
  updateCalendar(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateCalendarDto,
  ) {
    return this.scheduling.updateCalendar(id, this.org(request), input);
  }

  @Delete('calendars/:id')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.calendars.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCalendar(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.scheduling.removeCalendar(id, this.org(request));
  }

  @Get('events')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  @ApiOperation({ summary: 'List expanded event occurrences in a time range' })
  events(@Req() request: IdentityRequest, @Query() query: EventQueryDto) {
    return this.scheduling.occurrences(this.org(request), query);
  }

  @Post('events')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.events.create')
  createEvent(@Req() request: IdentityRequest, @Body() input: CreateEventDto) {
    return this.scheduling.createEvent(
      this.org(request),
      request.identity!.id,
      input,
    );
  }

  @Get('events/:id/timeline')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  timeline(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.scheduling.timeline(id, this.org(request));
  }

  @Post('events/:id/allocations')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.allocations.manage')
  allocate(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: AddAllocationDto,
  ) {
    return this.scheduling.addAllocation(
      id,
      this.org(request),
      request.identity!.id,
      input,
    );
  }

  @Delete('events/:id/allocations/:allocationId')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.allocations.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  release(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('allocationId', ParseUUIDv7Pipe) allocationId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.scheduling.removeAllocation(
      id,
      allocationId,
      this.org(request),
      request.identity!.id,
    );
  }

  @Get('events/:id')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  event(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.scheduling.getEvent(id, this.org(request));
  }

  @Patch('events/:id')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.events.update')
  updateEvent(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateEventDto,
  ) {
    return this.scheduling.updateEvent(
      id,
      this.org(request),
      request.identity!.id,
      input,
    );
  }

  @Delete('events/:id')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.events.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeEvent(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.scheduling.removeEvent(
      id,
      this.org(request),
      request.identity!.id,
    );
  }

  @Get('agenda')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  @ApiOperation({ summary: 'Return day, week or month agenda Read Model' })
  @ApiOkResponse({ description: 'Agenda grouped by day' })
  agenda(@Req() request: IdentityRequest, @Query() query: AgendaQueryDto) {
    return this.scheduling.agenda(this.org(request), query);
  }

  @Get('availability')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  availability(
    @Req() request: IdentityRequest,
    @Query() query: AvailabilityQueryDto,
  ) {
    return this.scheduling.listAvailability(this.org(request), query);
  }

  @Post('availability')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.availability.manage')
  createAvailability(
    @Req() request: IdentityRequest,
    @Body() input: CreateAvailabilityDto,
  ) {
    return this.scheduling.createAvailability(this.org(request), input);
  }

  @Delete('availability/:id')
  @Capabilities('scheduling.manage')
  @Permissions('scheduling.availability.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAvailability(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.scheduling.removeAvailability(id, this.org(request));
  }

  @Get('conflicts')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  conflicts(@Req() request: IdentityRequest, @Query() query: EventQueryDto) {
    return this.scheduling.conflicts(this.org(request), query);
  }

  @Get('intelligence')
  @ProductCapabilities(PlanCapability.ORBIT_INTELLIGENCE)
  @RequiresProductFeature(ProductFeature.SCHEDULING_INTELLIGENCE)
  @Capabilities('scheduling.intelligence')
  @Permissions('scheduling.intelligence.read')
  @ApiOperation({ summary: 'Return mocked Scheduling Intelligence contracts' })
  intelligence(@Req() request: IdentityRequest, @Query() query: EventQueryDto) {
    return this.scheduling.intelligence(this.org(request), query);
  }

  @Get('dashboard')
  @Capabilities('scheduling.read')
  @Permissions('scheduling.read')
  @ApiOperation({ summary: 'Return the Scheduling Read Model for Dashboard' })
  dashboard(@Req() request: IdentityRequest) {
    return this.scheduling.dashboardReadModel(this.org(request));
  }

  private org(request: IdentityRequest) {
    if (!request.identity?.organizationId)
      throw new ForbiddenException('Organization context is required');
    return request.identity.organizationId;
  }
}
