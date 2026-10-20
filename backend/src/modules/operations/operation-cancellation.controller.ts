import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ParseUUIDv7Pipe } from '../../pipes';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import { ResolveOperationCancellationDto } from './dto/operation-cancellation.dto';
import { OperationCancellationService } from './operation-cancellation.service';

/**
 * Os pedidos de cancelamento, do lado de quem decide.
 *
 * Rota própria e não um recorte de `/operations`: a pergunta aqui é "o que o campo
 * me devolveu hoje?", atravessando atendimentos — e não "o que há neste
 * atendimento?". Pendurá-la em `/operations/:id` obrigaria o dono a abrir um por um
 * para descobrir quais têm pedido.
 *
 * `operations.status.update` para resolver, porque é disso que se trata: decidir o
 * desfecho de um atendimento. Ler a caixa pede só `operations.read`.
 */
@ApiTags('Operations')
@Controller('operations/cancellation-requests')
@RequiresActivePlan()
export class OperationCancellationController {
  constructor(private readonly service: OperationCancellationService) {}

  @Get()
  @Capabilities('operations.read')
  @Permissions('operations.read')
  @ApiOperation({ summary: 'Pedidos de cancelamento vindos do campo' })
  list(@Req() request: IdentityRequest, @Query('status') status?: string) {
    return this.service.inbox(
      request.identity!.organizationId!,
      status === 'RESOLVED' ? 'RESOLVED' : 'PENDING',
    );
  }

  /**
   * Registra o desfecho.
   *
   * Só o desfecho: reagendar e reatribuir acontecem pelas rotas de operação que já
   * existem, com o histórico e as validações delas. A tela encadeia as duas
   * chamadas — resolver e agir —, e é a ordem certa: resolver primeiro fecha a
   * janela em que dois donos decidem o mesmo pedido.
   */
  @Post(':id/resolve')
  @Capabilities('operations.read')
  @Permissions('operations.status.update')
  @ApiOperation({ summary: 'Decide o que fazer com um pedido de cancelamento' })
  resolve(
    @Req() request: IdentityRequest,
    @Param('id', ParseUUIDv7Pipe) id: string,
    @Body() input: ResolveOperationCancellationDto,
  ) {
    return this.service.resolve(
      request.identity!.organizationId!,
      request.identity!.id,
      id,
      input,
    );
  }
}
