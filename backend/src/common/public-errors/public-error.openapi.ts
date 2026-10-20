import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import {
  PUBLIC_ERROR_CODES,
  PUBLIC_VALIDATION_CODES,
  type PublicErrorCode,
  type PublicValidationCode,
} from './public-error.read-models';

export class PublicValidationIssueDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ enum: PUBLIC_VALIDATION_CODES })
  code!: PublicValidationCode;

  @ApiProperty({ example: 'Informe um e-mail válido.' })
  message!: string;
}

export class PublicErrorDto {
  @ApiProperty({ enum: PUBLIC_ERROR_CODES })
  code!: PublicErrorCode;

  @ApiProperty({ example: 'Revise os campos informados.' })
  message!: string;

  @ApiProperty({ example: 400 })
  status!: number;

  @ApiPropertyOptional({
    oneOf: [
      {
        type: 'array',
        items: { $ref: getSchemaPath(PublicValidationIssueDto) },
      },
      {
        type: 'object',
        properties: { retryAfterSeconds: { type: 'number', example: 60 } },
      },
    ],
  })
  details?:
    | readonly PublicValidationIssueDto[]
    | {
        retryAfterSeconds: number;
      };
}

export class PublicErrorEnvelopeDto {
  @ApiProperty({ example: false })
  success!: false;

  @ApiProperty({ type: () => PublicErrorDto })
  error!: PublicErrorDto;

  @ApiProperty({ example: '019...' })
  requestId!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;
}

/** Respostas públicas reutilizáveis; evita schemas manuais por endpoint. */
export function ApiPublicErrors(): ClassDecorator & MethodDecorator {
  const schema = { $ref: getSchemaPath(PublicErrorEnvelopeDto) };
  return applyDecorators(
    ApiExtraModels(
      PublicValidationIssueDto,
      PublicErrorDto,
      PublicErrorEnvelopeDto,
    ),
    ApiResponse({ status: 400, description: 'Dados inválidos', schema }),
    ApiResponse({
      status: 401,
      description: 'Sessão inválida ou expirada',
      schema,
    }),
    ApiResponse({ status: 403, description: 'Acesso recusado', schema }),
    ApiResponse({ status: 404, description: 'Recurso não encontrado', schema }),
    ApiResponse({ status: 409, description: 'Conflito de dados', schema }),
    ApiResponse({
      status: 422,
      description: 'Regra de negócio não atendida',
      schema,
    }),
    ApiResponse({
      status: 429,
      description: 'Limite de requisições atingido',
      schema,
    }),
    ApiResponse({ status: 500, description: 'Falha interna segura', schema }),
  );
}
