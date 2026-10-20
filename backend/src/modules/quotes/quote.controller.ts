/**
 * API do Commercial Engine.
 *
 * ## Ações com nome de negócio
 *
 * Não há `PATCH /quotes/:id/status`. Enviar, aprovar, recusar e cancelar
 * registram coisas diferentes — quem enviou, quem decidiu, por quê — e um
 * campo genérico apagaria a distinção, além de permitir saltar de rascunho a
 * aprovado sem que nada tivesse sido proposto.
 *
 * ## Permissão comercial é independente
 *
 * `quotes.read` e `quotes.manage` não decorrem de `crm.read` nem de
 * `catalog.read`: ter a carteira de clientes ou a tabela de preços não é o
 * mesmo que poder propor um valor em nome da empresa. Quem só consulta
 * propostas também não pode aprová-las — aprovar move dinheiro previsto.
 */
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
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  AddQuoteItemDto,
  CancelQuoteDto,
  ConvertQuoteDto,
  CreateQuoteDto,
  CreateQuoteFromOperationDto,
  QuoteQueryDto,
  RejectQuoteDto,
  UpdateQuoteDto,
  UpdateQuoteItemDto,
} from './quote.dto';
import { QuoteMapper } from './quote.mapper';
import { QuoteEmissionService } from './quote-emission.service';
import { QuoteService } from './quote.service';

@ApiTags('Quotes')
@Controller('quotes')
@RequiresActivePlan()
export class QuoteController {
  constructor(
    private readonly quotes: QuoteService,
    private readonly mapper: QuoteMapper,
    private readonly emission: QuoteEmissionService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Leitura                                                           */
  /* ---------------------------------------------------------------- */

  @Get()
  @Capabilities('quotes.read')
  @Permissions('quotes.read')
  async list(@Req() request: IdentityRequest, @Query() query: QuoteQueryDto) {
    const result = await this.quotes.list(this.org(request), query);
    return {
      data: result.data.map((quote) => this.mapper.summary(quote)),
      meta: result.meta,
    };
  }

  /**
   * A proposta em PDF.
   *
   * Declarada antes de `:id` porque o Nest resolve na ordem de declaração, e
   * uma rota mais específica registrada depois nunca é alcançada.
   *
   * `quotes.read` e não `quotes.manage`: imprimir a proposta é lê-la.
   * `no-store` porque o orçamento muda enquanto é rascunho — um PDF em cache
   * mostraria valores que já não valem, e quem enviasse esse arquivo ao
   * cliente estaria propondo um preço que o sistema não pratica mais.
   */
  @Get(':id/document')
  @Capabilities('quotes.read')
  @Permissions('quotes.read')
  async document(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const documento = await this.quotes.document(id, this.org(request));

    response.set({
      'Content-Type': documento.mimeType,
      'Content-Disposition': `inline; filename="${documento.fileName}"`,
      'Cache-Control': 'no-store',
    });

    return new StreamableFile(documento.bytes);
  }

  /**
   * Emitir o documento da proposta.
   *
   * Declarada antes de `:id` pela mesma razão do PDF: o Nest resolve na ordem de
   * declaração.
   *
   * `quotes.manage` e não `quotes.read`, ao contrário de baixar: baixar é ler a
   * proposta, emitir **cria um documento** com código e revisão. E
   * `artifact_executions.create`, porque é literalmente o que acontece — quem não
   * pode criar execução não emite por esta porta de atalho.
   */
  @Post(':id/document/issue')
  @Capabilities('quotes.manage', 'artifact_executions.create')
  @Permissions('quotes.manage', 'artifact_executions.create')
  issueDocument(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.emission.issue(id, this.org(request), this.actor(request));
  }

  @Get(':id')
  @Capabilities('quotes.read')
  @Permissions('quotes.read')
  async detail(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.mapper.detail(await this.quotes.get(id, this.org(request)));
  }

  /* ---------------------------------------------------------------- */
  /* Rascunho                                                          */
  /* ---------------------------------------------------------------- */

  @Post()
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async create(@Req() request: IdentityRequest, @Body() input: CreateQuoteDto) {
    return this.mapper.detail(
      await this.quotes.create(
        this.org(request),
        request.identity?.businessUnitId ?? null,
        this.actor(request),
        input,
      ),
    );
  }

  /**
   * A proposta copiada de um atendimento concluído.
   *
   * Rota própria porque são duas operações diferentes com a mesma aparência:
   * criar recebe os dados, copiar **lê** um registro que já existe. Um
   * `operationId` opcional no `POST /quotes` tornaria metade dos campos
   * condicionalmente obrigatórios, e a recusa deixaria de dizer o que fazer.
   *
   * Exige `operations.read` além de `quotes.manage`: quem copia um atendimento
   * está lendo o atendimento, e o cliente, o endereço e os equipamentos dele
   * atravessam para a proposta.
   */
  @Post('from-operation')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage', 'operations.read')
  async createFromOperation(
    @Req() request: IdentityRequest,
    @Body() input: CreateQuoteFromOperationDto,
  ) {
    return this.mapper.detail(
      await this.quotes.createFromOperation(
        this.org(request),
        request.identity?.businessUnitId ?? null,
        this.actor(request),
        input,
      ),
    );
  }

  @Patch(':id')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async update(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateQuoteDto,
  ) {
    return this.mapper.detail(
      await this.quotes.update(
        id,
        this.org(request),
        this.actor(request),
        input,
      ),
    );
  }

  /** Só rascunho. Proposta enviada é cancelada, não apagada. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async remove(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ): Promise<void> {
    await this.quotes.remove(id, this.org(request), this.actor(request));
  }

  /* ---------------------------------------------------------------- */
  /* Itens                                                             */
  /* ---------------------------------------------------------------- */

  @Post(':id/items')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async addItem(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: AddQuoteItemDto,
  ) {
    return this.mapper.detail(
      await this.quotes.addItem(
        id,
        this.org(request),
        this.actor(request),
        input,
      ),
    );
  }

  @Patch(':id/items/:itemId')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async updateItem(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('itemId', ParseUUIDv7Pipe) itemId: string,
    @Req() request: IdentityRequest,
    @Body() input: UpdateQuoteItemDto,
  ) {
    return this.mapper.detail(
      await this.quotes.updateItem(
        id,
        itemId,
        this.org(request),
        this.actor(request),
        input,
      ),
    );
  }

  @Delete(':id/items/:itemId')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async removeItem(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Param('itemId', ParseUUIDv7Pipe) itemId: string,
    @Req() request: IdentityRequest,
  ) {
    return this.mapper.detail(
      await this.quotes.removeItem(
        id,
        itemId,
        this.org(request),
        this.actor(request),
      ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Transições                                                        */
  /* ---------------------------------------------------------------- */

  @Post(':id/send')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async send(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.mapper.detail(
      await this.quotes.send(id, this.org(request), this.actor(request)),
    );
  }

  /** Aprovar cria receita **prevista**, nunca realizada. */
  @Post(':id/approve')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async approve(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
  ) {
    return this.mapper.detail(
      await this.quotes.approve(id, this.org(request), this.actor(request)),
    );
  }

  @Post(':id/reject')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async reject(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: RejectQuoteDto,
  ) {
    return this.mapper.detail(
      await this.quotes.reject(
        id,
        this.org(request),
        this.actor(request),
        input,
      ),
    );
  }

  @Post(':id/cancel')
  @Capabilities('quotes.manage')
  @Permissions('quotes.manage')
  async cancel(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: CancelQuoteDto,
  ) {
    return this.mapper.detail(
      await this.quotes.cancel(
        id,
        this.org(request),
        this.actor(request),
        input,
      ),
    );
  }

  /**
   * Converte a proposta aprovada em operação.
   *
   * Idempotente: repetir devolve a mesma operação. Exige também
   * `operations.manage` — criar trabalho em campo é ato do domínio de
   * operações, e quem só cuida de propostas não o abre sozinho.
   */
  @Post(':id/convert-to-operation')
  @Capabilities('quotes.manage', 'operations.manage')
  @Permissions('quotes.manage', 'operations.create')
  async convert(
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Req() request: IdentityRequest,
    @Body() input: ConvertQuoteDto,
  ) {
    return this.mapper.detail(
      await this.quotes.convert(
        id,
        this.org(request),
        this.actor(request),
        input,
      ),
    );
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
