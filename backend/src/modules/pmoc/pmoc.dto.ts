import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsObject,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { IsUUIDv7 } from '../../validators';
import { CursorDto } from '../../dtos/foundation.dto';
import {
  COMPLIANCE_STATUSES,
  FREQUENCY_UNITS,
  PLAN_STATUSES,
  type FrequencyUnit,
} from './pmoc.domain';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** `YYYY-MM-DD` — vigência e vencimento são **dias**, não instantes. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class PmocCoveragePageQueryDto extends CursorDto {
  @ApiPropertyOptional({
    description: 'Equipment name, identifier or serial number',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}

export class PmocTimelineQueryDto extends CursorDto {}

/**
 * O que o preview recebe.
 *
 * A vigência chega de duas formas, e só uma por vez: `coverageAmount` +
 * `coverageUnit` quando a tela pergunta *"vigência"* (que é duração), ou
 * `endsOn` quando quem chama já tem a data. A duração é a forma canônica do
 * wizard — deixar o usuário somar seis meses à mão é como nasce o sétimo
 * ciclo que ninguém contratou.
 */
export class PreviewPmocPlanDto {
  @ApiProperty()
  @IsUUIDv7()
  businessUnitId!: string;

  @ApiProperty()
  @IsUUIDv7()
  customerId!: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(DATE_ONLY, { message: 'startsOn must be YYYY-MM-DD' })
  startsOn!: string;

  @ApiPropertyOptional({ example: '2026-06-30' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'endsOn must be YYYY-MM-DD' })
  endsOn?: string;

  @ApiPropertyOptional({ example: 6, description: 'Vigência, como duração.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  coverageAmount?: number;

  @ApiPropertyOptional({ enum: FREQUENCY_UNITS, default: 'MONTHS' })
  @IsOptional()
  @IsIn(FREQUENCY_UNITS)
  coverageUnit?: FrequencyUnit;

  @ApiProperty({ example: 1, description: 'Frequência de atendimento.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  frequencyAmount!: number;

  @ApiProperty({ enum: FREQUENCY_UNITS })
  @IsIn(FREQUENCY_UNITS)
  frequencyUnit!: FrequencyUnit;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUIDv7({ each: true })
  assetIds?: string[];

  /**
   * As unidades que este plano declara.
   *
   * Unidade não é equipamento: `assetIds` são as máquinas sob contrato;
   * estas são as partes do sistema que recebem manutenção — condensadora,
   * evaporadora, dutos —, e é por elas que o relatório final descreve o
   * serviço. Cada uma traz o seu roteiro.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUIDv7({ each: true })
  unitIds?: string[];
}

export class PmocCodeSuggestionQueryDto {
  @ApiProperty()
  @IsUUIDv7()
  customerId!: string;
}

export class CreatePmocPlanDto {
  @ApiProperty()
  @IsUUIDv7()
  businessUnitId!: string;

  @ApiProperty()
  @IsUUIDv7()
  customerId!: string;

  /**
   * O código do plano.
   *
   * **Omitir é o caminho canônico**: o backend aloca o próximo da sequência do
   * cliente dentro da transação do create, e nenhuma corrida colide. Enviar um
   * código significa *"este é meu, não gere"* — e aí ele é validado como
   * customizado, respeitando a unicidade da organização.
   *
   * Continua aceito por retrocompatibilidade com quem já chamava este endpoint
   * mandando o código à mão.
   */
  @ApiPropertyOptional({ example: 'PMOC-CLINICA-SANTA-MARIA-001' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(60)
  code?: string;

  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(220)
  name!: string;

  @ApiProperty({ example: '2026-01-01' })
  @Matches(DATE_ONLY, { message: 'startsOn must be YYYY-MM-DD' })
  startsOn!: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'endsOn must be YYYY-MM-DD' })
  endsOn?: string;

  @ApiProperty({ example: 6 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  frequencyAmount!: number;

  @ApiProperty({ enum: FREQUENCY_UNITS })
  @IsIn(FREQUENCY_UNITS)
  frequencyUnit!: FrequencyUnit;

  /** Antecedência do aviso de vencimento. Ver `evaluateCompliance`. */
  @ApiPropertyOptional({ default: 15 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  dueSoonDays?: number;

  /**
   * Equipamentos que participam do plano.
   *
   * Opcional no contrato por retrocompatibilidade — quem já chamava este
   * endpoint sem equipamento continua funcionando, e adiciona depois por
   * `POST /pmoc/plans/:id/equipment`. O fluxo novo do produto sempre manda a
   * lista, e aí plano e coberturas nascem na mesma transação.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUIDv7({ each: true })
  assetIds?: string[];

  /**
   * As unidades que este plano declara.
   *
   * Unidade não é equipamento: `assetIds` são as máquinas sob contrato;
   * estas são as partes do sistema que recebem manutenção — condensadora,
   * evaporadora, dutos —, e é por elas que o relatório final descreve o
   * serviço. Cada uma traz o seu roteiro.
   */
  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUIDv7({ each: true })
  unitIds?: string[];

  /**
   * Responsável técnico — **referência operacional**.
   *
   * É um membro da organização, não um registro profissional: o Orbit não
   * guarda CREA nem ART, e inventá-los aqui daria aparência de conformidade
   * regulatória a um campo que ninguém verifica. Esses dados existem no
   * formulário do artefato PMOC, preenchidos e assinados por quem responde
   * por eles.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  technicianUserId?: string;

  @ApiPropertyOptional({ description: 'PR-27 eligible technical responsible' })
  @IsOptional()
  @IsUUIDv7()
  technicalResponsibleUserId?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  serviceLocation?: Record<string, unknown>;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  scope?: Record<string, unknown>;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceTypes?: string[];

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  procedure?: Record<string, unknown>;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  schedulingPaused?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  reviewRequired?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(4000)
  notes?: string;
}

/**
 * Edição.
 *
 * **Sem `businessUnitId`, `customerId` e `code`**: mudar qualquer um deles
 * transformaria o plano em outro, com as execuções do anterior penduradas nele.
 * Quem errou cria outro plano; o histórico dos dois continua legível.
 */
export class UpdatePmocPlanDto extends PartialType(CreatePmocPlanDto) {
  override businessUnitId?: never;
  override customerId?: never;
  override code?: never;
}

export class TransitionPmocPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AddPmocCoverageDto {
  @ApiProperty()
  @IsUUIDv7()
  assetId!: string;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'startsOn must be YYYY-MM-DD' })
  startsOn?: string;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'endsOn must be YYYY-MM-DD' })
  endsOn?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/**
 * Conclusão de um ciclo.
 *
 * `performedAt` é **quando a manutenção aconteceu**, não quando alguém
 * registrou: a próxima é contada a partir dela, e usar o instante do registro
 * empurraria o calendário a cada atraso de digitação.
 */
export class CompletePmocExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  performedAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  artifactExecutionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

/** Vínculo da evidência documental a um ciclo já existente. */
export class LinkPmocEvidenceDto {
  @ApiProperty()
  @IsUUIDv7()
  artifactExecutionId!: string;
}

export class CreatePmocOperationDto {
  @ApiPropertyOptional({ example: 'MAINTENANCE' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  kind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledStart?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  scheduledEnd?: Date;
}

export class StartPmocEquipmentExecutionDto {
  @ApiProperty()
  @IsUUIDv7()
  responsibleFieldTechnicianId!: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUIDv7({ each: true })
  auxiliaryTechnicianIds?: string[];
}

export class CompletePmocEquipmentExecutionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  performedAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class AddPmocEquipmentEvidenceDto {
  @ApiProperty()
  @IsUUIDv7()
  storageFileId!: string;

  @ApiPropertyOptional({
    enum: ['PHOTO', 'VIDEO', 'DOCUMENT'],
    default: 'PHOTO',
  })
  @IsOptional()
  @IsIn(['PHOTO', 'VIDEO', 'DOCUMENT'])
  kind?: 'PHOTO' | 'VIDEO' | 'DOCUMENT';

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  caption?: string;
}

export class GeneratePmocEquipmentArtifactDto {
  @ApiPropertyOptional({ example: 'pdf.default', default: 'pdf.default' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(/^[a-z][a-z0-9._-]*$/)
  renderer = 'pdf.default';
}

export class PmocPlanQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(220)
  search?: string;

  @ApiPropertyOptional({ enum: PLAN_STATUSES })
  @IsOptional()
  @IsIn(PLAN_STATUSES)
  status?: string;

  @ApiPropertyOptional({ enum: COMPLIANCE_STATUSES })
  @IsOptional()
  @IsIn(COMPLIANCE_STATUSES)
  compliance?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  customerId?: string;

  /** Planos que cobrem um equipamento específico. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  assetId?: string;

  /** Vencimento até esta data — "o que vence este mês". */
  @ApiPropertyOptional({ example: '2026-03-31' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'dueUntil must be YYYY-MM-DD' })
  dueUntil?: string;

  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class PmocAnalyticsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;
}

export class PmocUpcomingQueryDto {
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days = 30;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  businessUnitId?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}

/* ------------------------------------------------------------------ */
/* Unidades                                                            */
/* ------------------------------------------------------------------ */

export class CreatePmocUnitDto {
  @ApiProperty({ example: 'CONDENSADORA' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  key!: string;

  @ApiProperty({ example: 'Unidade condensadora' })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** O roteiro desta unidade. Pode vir depois. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUIDv7()
  checklistTemplateId?: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class UpdatePmocUnitDto extends PartialType(CreatePmocUnitDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/* ------------------------------------------------------------------ */
/* Assinatura pública do contrato                                     */
/* ------------------------------------------------------------------ */

/**
 * O que o contratante declara ao assinar.
 *
 * Nome é obrigatório porque é ele que sai no documento ao lado da assinatura — uma
 * imagem sem nome não identifica ninguém. Documento e e-mail são opcionais: nem todo
 * contratante é pessoa jurídica com CNPJ à mão, e travar o aceite nisso impediria a
 * assinatura de acontecer, que é o que o recurso existe para conseguir.
 */
export class SignPmocContractDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(180)
  signerName!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(40)
  signerDocument?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(180)
  signerEmail?: string;

  /**
   * A assinatura em PNG, base64 — sem o prefixo `data:`.
   *
   * O limite de tamanho é o do corpo: 1MB no `main.ts`. Uma assinatura desenhada à
   * mão pesa alguns quilobytes, e o teto existe para o caso de alguém mandar uma
   * foto no lugar do traço.
   */
  @ApiProperty()
  @IsString()
  @MinLength(64)
  @MaxLength(700_000)
  signatureBase64!: string;
}
