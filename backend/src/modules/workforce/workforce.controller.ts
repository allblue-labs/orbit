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
  AddTeamMemberDto,
  AssignSpecialtyDto,
  CertificationQueryDto,
  CreateCertificationDto,
  CreateSpecialtyDto,
  CreateTeamDto,
  LocationQueryDto,
  ReportLocationDto,
  UpdateCertificationDto,
  UpdateSpecialtyDto,
  UpdateTeamDto,
  UpdateProfessionalProfileDto,
  ProfessionalSelectorQueryDto,
  CreateProfessionalCredentialDto,
  RegisterProfessionalSignatureDto,
  ProfessionalEligibilityQueryDto,
} from './workforce.dto';
import { WorkforceMapper } from './workforce.mapper';
import { WorkforceService } from './workforce.service';

/**
 * Workforce — especialidades, certificações, equipes e geolocalização.
 *
 * Complementa `organizations/current/members`, que responde "quem faz parte e
 * com que papel". **Nada aqui participa de autenticação ou autorização.**
 */
@ApiTags('Workforce')
@Controller('workforce')
@RequiresActivePlan()
export class WorkforceController {
  constructor(
    private readonly workforce: WorkforceService,
    private readonly mapper: WorkforceMapper,
  ) {}

  @Get('field-technicians')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  fieldTechnicians(
    @Req() request: IdentityRequest,
    @Query() query: ProfessionalSelectorQueryDto,
  ) {
    return this.workforce.listProfessionals(
      this.org(request),
      'FIELD_TECHNICIAN',
      query.businessUnitId,
    );
  }

  /**
   * Quem pode acompanhar um atendimento como auxiliar.
   *
   * Porta separada da de técnicos porque a pergunta é outra: ali é quem executa
   * e assina, aqui é quem lê. O papel "Auxiliar técnico" não aparecia em porta
   * nenhuma, e o campo de auxiliares do formulário de operação ficava vazio
   * mesmo com auxiliares cadastrados.
   */
  @Get('field-assistants')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  fieldAssistants(
    @Req() request: IdentityRequest,
    @Query() query: ProfessionalSelectorQueryDto,
  ) {
    return this.workforce.listFieldAssistantCandidates(
      this.org(request),
      query.businessUnitId,
    );
  }

  @Get('eligible-technical-responsibles')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  technicalResponsibles(
    @Req() request: IdentityRequest,
    @Query() query: ProfessionalSelectorQueryDto,
  ) {
    return this.workforce.listProfessionals(
      this.org(request),
      'TECHNICAL_RESPONSIBLE',
      query.businessUnitId,
    );
  }

  @Get('members/:userId/professional-profile')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  professionalProfile(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.workforce.professionalProfile(this.org(request), userId);
  }

  @Patch('members/:userId/professional-profile')
  @Capabilities('workforce.manage')
  @Permissions('organization.members.update')
  updateProfessionalProfile(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateProfessionalProfileDto,
  ) {
    return this.workforce.updateProfessionalProfile(
      this.org(request),
      userId,
      this.actor(request),
      input,
    );
  }

  @Post('members/:userId/professional-credentials')
  @Capabilities('workforce.manage')
  @Permissions('organization.members.update')
  createProfessionalCredential(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
    @Body() input: CreateProfessionalCredentialDto,
  ) {
    return this.workforce.addProfessionalCredential(
      this.org(request),
      userId,
      this.actor(request),
      input,
    );
  }

  @Delete('professional-credentials/:id')
  @Capabilities('workforce.manage')
  @Permissions('organization.members.update')
  revokeProfessionalCredential(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.workforce.revokeProfessionalCredential(
      this.org(request),
      id,
      this.actor(request),
    );
  }

  @Post('members/:userId/signature')
  @Capabilities('workforce.manage')
  @Permissions('organization.members.update')
  registerProfessionalSignature(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
    @Body() input: RegisterProfessionalSignatureDto,
  ) {
    return this.workforce.registerProfessionalSignature(
      this.org(request),
      userId,
      this.actor(request),
      input.storageObjectId,
    );
  }

  @Get('members/:userId/document-eligibility')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  professionalEligibility(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
    @Query() query: ProfessionalEligibilityQueryDto,
  ) {
    return this.workforce.professionalEligibility(
      this.org(request),
      userId,
      query,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Especialidades                                                    */
  /* ---------------------------------------------------------------- */

  @Get('specialties')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  async specialties(@Req() request: IdentityRequest) {
    const items = await this.workforce.listSpecialties(this.org(request));
    return items.map((item) => this.mapper.specialty(item));
  }

  @Post('specialties')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async createSpecialty(
    @Req() request: IdentityRequest,
    @Body() input: CreateSpecialtyDto,
  ) {
    return this.mapper.specialty(
      await this.workforce.createSpecialty(this.org(request), input),
    );
  }

  @Patch('specialties/:id')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async updateSpecialty(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateSpecialtyDto,
  ) {
    return this.mapper.specialty(
      await this.workforce.updateSpecialty(id, this.org(request), input),
    );
  }

  @Delete('specialties/:id')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeSpecialty(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.workforce.removeSpecialty(id, this.org(request));
  }

  /* ---------------------------------------------------------------- */
  /* Especialidades de membros                                         */
  /* ---------------------------------------------------------------- */

  @Get('members/specialties')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  async memberSpecialties(
    @Req() request: IdentityRequest,
    @Query('userId') userId?: string,
  ) {
    const items = await this.workforce.listMemberSpecialties(
      this.org(request),
      userId,
    );
    return items.map((item) => this.mapper.memberSpecialty(item));
  }

  @Post('members/:userId/specialties')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async assignSpecialty(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
    @Body() input: AssignSpecialtyDto,
  ) {
    return this.mapper.memberSpecialty(
      await this.workforce.assignSpecialty(this.org(request), userId, input),
    );
  }

  @Delete('members/:userId/specialties/:specialtyId')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  unassignSpecialty(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Param('specialtyId', ParseUUIDv7Pipe) specialtyId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.workforce.unassignSpecialty(
      this.org(request),
      userId,
      specialtyId,
    );
  }

  /* ---------------------------------------------------------------- */
  /* Certificações                                                     */
  /* ---------------------------------------------------------------- */

  @Get('certifications')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  async certifications(
    @Req() request: IdentityRequest,
    @Query() query: CertificationQueryDto,
  ) {
    const items = await this.workforce.listCertifications(
      this.org(request),
      query,
    );
    return items.map((item) => this.mapper.certification(item));
  }

  @Post('members/:userId/certifications')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async createCertification(
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
    @Body() input: CreateCertificationDto,
  ) {
    return this.mapper.certification(
      await this.workforce.createCertification(
        this.org(request),
        userId,
        input,
      ),
    );
  }

  @Patch('certifications/:id')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async updateCertification(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateCertificationDto,
  ) {
    return this.mapper.certification(
      await this.workforce.updateCertification(id, this.org(request), input),
    );
  }

  @Delete('certifications/:id')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCertification(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.workforce.removeCertification(id, this.org(request));
  }

  /* ---------------------------------------------------------------- */
  /* Equipes                                                           */
  /* ---------------------------------------------------------------- */

  @Get('teams')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  async teams(@Req() request: IdentityRequest) {
    const items = await this.workforce.listTeams(this.org(request));
    return items.map((item) => this.mapper.team(item));
  }

  @Get('teams/:id')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  async team(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.mapper.team(
      await this.workforce.getTeam(id, this.org(request)),
    );
  }

  @Post('teams')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async createTeam(
    @Req() request: IdentityRequest,
    @Body() input: CreateTeamDto,
  ) {
    return this.mapper.team(
      await this.workforce.createTeam(this.org(request), input),
    );
  }

  @Patch('teams/:id')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async updateTeam(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateTeamDto,
  ) {
    return this.mapper.team(
      await this.workforce.updateTeam(id, this.org(request), input),
    );
  }

  @Delete('teams/:id')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeTeam(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.workforce.removeTeam(id, this.org(request));
  }

  @Post('teams/:id/members')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async addTeamMember(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: AddTeamMemberDto,
  ) {
    return this.mapper.team(
      await this.workforce.addTeamMember(id, this.org(request), input),
    );
  }

  @Delete('teams/:id/members/:userId')
  @Capabilities('workforce.manage')
  @Permissions('organization.update')
  async removeTeamMember(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('userId', ParseUUIDv7Pipe) userId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.mapper.team(
      await this.workforce.removeTeamMember(id, this.org(request), userId),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Geolocalização                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Registra a **própria** posição.
   *
   * Sem `userId` no caminho nem no corpo: quem reporta é quem está
   * autenticado. Publicar a posição de outro seria vigilância por procuração.
   * Não exige `workforce.manage` — qualquer pessoa da equipe reporta a sua.
   */
  @Post('me/location')
  @Capabilities('workforce.read')
  @HttpCode(HttpStatus.ACCEPTED)
  async reportLocation(
    @Req() request: IdentityRequest,
    @Body() input: ReportLocationDto,
  ) {
    await this.workforce.reportLocation(
      this.org(request),
      this.actor(request),
      input,
    );
    return { accepted: true };
  }

  /** Última posição de cada pessoa dentro da janela consultada. */
  @Get('locations')
  @Capabilities('workforce.read')
  @Permissions('organization.read')
  async locations(
    @Req() request: IdentityRequest,
    @Query() query: LocationQueryDto,
  ) {
    const items = await this.workforce.latestLocations(
      this.org(request),
      query.withinMinutes,
    );
    return items.map((item) => this.mapper.location(item));
  }

  private org(request: IdentityRequest): string {
    const id = request.identity?.organizationId;
    if (!id) throw new ForbiddenException('Organization context is required');
    return id;
  }

  private actor(request: IdentityRequest): string {
    const id = request.identity?.id;
    if (!id) throw new ForbiddenException('User context is required');
    return id;
  }
}
