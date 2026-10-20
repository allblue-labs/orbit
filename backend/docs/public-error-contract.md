# Contrato público de erros — API v1

## Objetivo e fronteiras

O contrato público não é a exceção interna. Domínio, Prisma, PostgreSQL,
providers e jobs mantêm mensagens e causas técnicas para diagnóstico; somente
o `PublicErrorMapper`, no boundary HTTP, escolhe código, copy e detalhes que
podem sair da API. O catálogo é estático, em memória e não adiciona consultas.

```json
{
  "success": false,
  "error": {
    "code": "CUSTOMER_DOCUMENT_ALREADY_EXISTS",
    "message": "Já existe um cliente cadastrado com este CPF ou CNPJ.",
    "status": 409
  },
  "requestId": "019...",
  "timestamp": "2026-09-06T12:00:00.000Z"
}
```

`error.code` é a authority para decisões de cliente. `message` é apresentação
PT-BR determinística. O status HTTP continua semântico e é repetido em
`error.status` para consumidores que desserializam apenas o corpo. O
`requestId` permanece no envelope e no header `x-request-id`.

## Stage 0 — inventário anterior

Havia um envelope externo, mas três variantes internas públicas: erro de
domínio com `message` arbitrária, `HttpException`/ValidationPipe com string ou
array cru e fallback 5xx. A auditoria estática encontrou 662 construções de
exceção no backend; 320 possuíam literal claramente inglês potencialmente
publicável. É uma medida de locais, não de códigos ou endpoints únicos.

O Web possuía 4 traduções `BACKEND_COMPENSATION` por regex em
`error-copy.ts`. O Flutter não mantinha catálogo completo, mas decidia o fluxo
de MFA procurando a palavra `mfa` na mensagem. Ambos foram reduzidos a zero.
Copy exclusivamente local de rede, timeout, cancelamento e parsing permanece.

| Fonte | Exceção anterior | HTTP | Exposição anterior | Idioma anterior | Código público | Mensagem pública |
|---|---|---:|---|---|---|---|
| DTO/ValidationPipe | `BadRequestException` + array class-validator | 400 | Sim, array cru | inglês | `VALIDATION_ERROR` | `Revise os campos informados.` |
| Domínio genérico | `ValidationException` | 400 | Sim | misto | `VALIDATION_ERROR` | `Revise os campos informados.` |
| Autenticação | `UnauthorizedException` | 401 | Sim | inglês | `UNAUTHORIZED` | `Sua sessão não é válida ou expirou.` |
| MFA requerido | `UnauthorizedException` | 401 | Sim | inglês | `MFA_REQUIRED` | `Informe o código do seu autenticador.` |
| Autorização/capability | `ForbiddenException` | 403 | Sim | inglês | `FORBIDDEN` | copy genérica sem capability |
| Hidden absence/RLS | `EntityNotFoundException` | 404 | Sim, incluindo entity/id | inglês | `ENTITY_NOT_FOUND` | copy genérica sem oracle |
| Cliente duplicado | Prisma P2002 → `ConflictException` | 409 | Sim | inglês | `CUSTOMER_DOCUMENT_ALREADY_EXISTS` | copy específica PT-BR |
| OCC | `ConflictException` | 409 | Sim | misto | `STALE_VERSION`/`RESOURCE_VERSION_CONFLICT` | recarregar e tentar novamente |
| Idempotência | `ConflictException` | 409 | Sim | misto | `IDEMPOTENCY_MISMATCH` | chave usada com dados diferentes |
| Rate limit | `RateLimitException` | 429 | Sim | inglês | `RATE_LIMITED` | copy PT-BR + `Retry-After` |
| Storage/arquivo | validação/forbidden | 400/403/413 | Sim | misto | `FILE_INVALID`, `FILE_TOO_LARGE`, `PAYLOAD_TOO_LARGE`, `STORAGE_SIGNATURE_INVALID` | copy sem bucket/object key |
| Artefatos/PMOC/RVT/Operations/Mobile | exceções de aplicação | 4xx | Sim | misto | código cadastrado ou fallback pelo status | copy catalogada ou genérica |
| Prisma/PostgreSQL desconhecido | erro inesperado | 500 | Não vazava causa, mas fallback era inglês | inglês | `INTERNAL_SERVER_ERROR` | `Não foi possível concluir a solicitação.` |
| Job/background | erro técnico persistido/logado | n/a | Não é resposta HTTP | técnico | contrato próprio do job | não alterado |

Prisma desconhecido nunca é convertido heurísticamente em regra de produto:
falha fechada em `INTERNAL_SERVER_ERROR`. P2002 só recebe código semântico onde
o domínio conhece com segurança a constraint, como documento de Cliente.

## Validação

`details` é opcional e, para DTOs, contém somente:

```json
[
  {
    "field": "email",
    "code": "INVALID_FORMAT",
    "message": "Informe um e-mail válido."
  }
]
```

Os códigos de campo são `REQUIRED`, `UNKNOWN_FIELD`, `INVALID_FORMAT`,
`INVALID_TYPE`, `INVALID_VALUE`, `MIN_LENGTH`, `MAX_LENGTH` e `OUT_OF_RANGE`.
O valor recebido e o texto cru do class-validator nunca são publicados. Paths
de DTO aninhado são preservados quando o ValidationPipe os fornece.

## Catálogo

O catálogo inicial possui 39 códigos únicos:

- base, autenticação e infraestrutura: 12;
- Cliente e Portal: 4;
- artefatos, renderização e assinaturas: 5;
- Chamados, OCC, idempotência e escopo: 12;
- mídia e storage: 6.

Os códigos já publicados por PR-34 (`STALE_VERSION`,
`CANCELLATION_NOT_ALLOWED`, `INVALID_STATUS_TRANSITION`,
`CONVERSION_NOT_ALLOWED` e `REQUEST_ALREADY_CONVERTED`) foram preservados.
Aliases mais explícitos podem ser usados por novos módulos, mas não substituem
um código existente sem depreciação. O registry falha no boot/test para código
duplicado ou definição ausente.

## Mapeamento final

| Origem | Regra |
|---|---|
| Domain/Application `BaseException` | código registrado → copy do catálogo; código desconhecido → fallback semântico do HTTP |
| Prisma/PostgreSQL conhecido | repository/service converte para código de produto explícito |
| Prisma/PostgreSQL desconhecido | `INTERNAL_SERVER_ERROR`, causa somente no log |
| ValidationPipe | `VALIDATION_ERROR` + issues estruturadas e redigidas |
| Auth/Portal | `UNAUTHORIZED` genérico; `MFA_REQUIRED` somente após credenciais válidas |
| Storage | códigos de arquivo/link, sem provider, bucket ou chave |
| Artefatos/Chamados | códigos existentes catalogados; enums e transições internas não são interpolados |
| Erro inesperado | fallback 500 invariável |

401 não distingue conta inexistente, senha errada, usuário desativado ou token
inválido. 403 não informa role/permissão/capability. Recursos fora do tenant ou
da unidade continuam retornando a ausência oculta 404.

## Web e Flutter

O Web lê `code`, `message`, `status`, `details` e `requestId`. O parser mantém
leitura temporária de arrays legados, mas nenhuma decisão compara
`error.message`. `error-copy.ts` conserva apenas falhas locais de transporte.

O Flutter usa o mesmo envelope e trata MFA por `MFA_REQUIRED`. Detalhes de
validação aceitam issues estruturadas; não há espelho do catálogo backend.

## OpenAPI e novos módulos

`ApiPublicErrors()` registra os schemas reutilizáveis
`PublicErrorEnvelopeDto`, `PublicErrorDto` e `PublicValidationIssueDto`. Novos
controllers devem aplicar o decorator na classe e lançar códigos de aplicação,
nunca montar envelopes manualmente. O Read Model é sincronizado pelo Orbit
Contracts Manifest.

## Compatibilidade

Não existe `/api/v2`. O envelope, `requestId`, `timestamp` e os status HTTP são
preservados. `error.status` e detalhes estruturados são aditivos; `message`
passa a ser sempre string. Web e Flutter toleram o formato legado durante a
transição. Nenhuma migration, policy RLS, authority ou regra de negócio foi
alterada.

Logs 5xx continuam contendo classe, categoria, código técnico e stack sob a
política de redaction. Nenhuma `cause`, senha, token, documento recebido ou
segredo de URL assinada é serializado na resposta pública.
