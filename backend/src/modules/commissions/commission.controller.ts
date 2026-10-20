/**
 * API da comissão de técnicos.
 *
 * ## É financeiro, e usa a permissão financeira
 *
 * Comissão é dinheiro a pagar: `financial.read` vê, `financial.manage` configura
 * e paga. Quem administra a equipe não passa a ver quanto cada técnico recebe —
 * `workforce.read` não abre nada aqui. O caminho de acesso não é o critério.
 *
 * ## O cliente escolhe o quê, nunca o quanto
 *
 * Nenhuma rota aceita valor. `POST /commissions/payments` recebe a pessoa e,
 * opcionalmente, quais comissões pagar; o valor é recalculado no servidor a
 * partir da política. Aceitar o valor do cliente seria deixar o pagador decidir
 * o preço.
 */
import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../decorators';
import { ForbiddenException } from '../../exceptions';
import type { IdentityRequest } from '../identity/infrastructure/jwt-authentication.guard';
import {
  Capabilities,
  RequiresActivePlan,
} from '../subscription-plans/plan-access';
import {
  CancelCommissionDto,
  CommissionListQueryDto,
  CommissionPaymentQueryDto,
  CommissionQueryDto,
  PayCommissionsDto,
  SaveCommissionPolicyDto,
} from './commission.dto';
import { CommissionService, type CommissionActor } from './commission.service';

@ApiTags('Commissions')
@Controller('commissions')
@RequiresActivePlan()
export class CommissionController {
  constructor(private readonly commissions: CommissionService) {}

  @Get('policy')
  @Capabilities('financial.read')
  @Permissions('financial.read')
  @ApiOperation({ summary: 'Read the commission policy' })
  policy(@Req() request: IdentityRequest) {
    return this.commissions.policy(this.actor(request));
  }

  @Put('policy')
  @Capabilities('financial.manage')
  @Permissions('financial.manage')
  @ApiOperation({ summary: 'Create or replace the commission policy' })
  savePolicy(
    @Req() request: IdentityRequest,
    @Body() input: SaveCommissionPolicyDto,
  ) {
    return this.commissions.savePolicy(this.actor(request), input);
  }

  /**
   * O resumo por técnico — o que a tabela da Equipe mostra.
   *
   * Vem antes da rota de listagem no arquivo, e não por acaso: `overview` é a
   * pergunta de quem fecha o mês ("quem tenho a pagar?"), e `list` é a de quem
   * confere um técnico.
   */
  @Get('overview')
  @Capabilities('financial.read')
  @Permissions('financial.read')
  @ApiOperation({ summary: 'Per-technician commission summary and workload' })
  overview(
    @Req() request: IdentityRequest,
    @Query() query: CommissionQueryDto,
  ) {
    return this.commissions.overview(this.actor(request), query);
  }

  @Get('payments')
  @Capabilities('financial.read')
  @Permissions('financial.read')
  @ApiOperation({ summary: 'Commission payment history' })
  payments(
    @Req() request: IdentityRequest,
    @Query() query: CommissionPaymentQueryDto,
  ) {
    return this.commissions.payments(this.actor(request), query);
  }

  @Post('payments')
  @Capabilities('financial.manage')
  @Permissions('financial.manage')
  @ApiOperation({
    summary: 'Pay pending commissions — all in the window, or a selection',
  })
  pay(@Req() request: IdentityRequest, @Body() input: PayCommissionsDto) {
    return this.commissions.pay(this.actor(request), input);
  }

  @Post('cancellations')
  @Capabilities('financial.manage')
  @Permissions('financial.manage')
  @ApiOperation({ summary: 'Decide não pagar uma comissão' })
  cancel(@Req() request: IdentityRequest, @Body() input: CancelCommissionDto) {
    return this.commissions.cancel(this.actor(request), input);
  }

  /**
   * Desfaz o cancelamento.
   *
   * `POST` e não `DELETE`: o que acontece é o registro de uma segunda decisão —
   * a cancelação fica no histórico com quem a desfez. `DELETE` sugeriria que a
   * primeira decisão desaparece.
   */
  @Post('cancellations/revocations')
  @Capabilities('financial.manage')
  @Permissions('financial.manage')
  @ApiOperation({ summary: 'Desfaz o cancelamento de uma comissão' })
  restore(@Req() request: IdentityRequest, @Body() input: CancelCommissionDto) {
    return this.commissions.restore(this.actor(request), input);
  }

  @Get()
  @Capabilities('financial.read')
  @Permissions('financial.read')
  @ApiOperation({ summary: 'Commissions in the window, pending and paid' })
  list(
    @Req() request: IdentityRequest,
    @Query() query: CommissionListQueryDto,
  ) {
    return this.commissions.list(this.actor(request), query);
  }

  private actor(request: IdentityRequest): CommissionActor {
    const organizationId = request.identity?.organizationId;
    const actorId = request.identity?.id;
    if (!organizationId || !actorId) {
      throw new ForbiddenException('Organization context is required');
    }
    return { organizationId, actorId };
  }
}
