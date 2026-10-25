import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, Surfaces } from '../../decorators';
import { LookupService } from './lookup.service';

/**
 * Consultas públicas que poupam digitação ao cadastrar.
 *
 * ## Por que na API, e não só no BFF da web
 *
 * A web consultava CEP por uma rota do próprio Next, que o aplicativo não
 * alcança — o celular fala com a API. O cadastro de cliente em campo ficava
 * sem busca de endereço, e digitar rua, bairro e cidade de luva na casa do
 * cliente é o caminho mais curto para ninguém cadastrar nada.
 *
 * ## Por que exige permissão de leitura de clientes
 *
 * Não é segredo o que estas rotas devolvem — é dado público. A permissão não
 * protege a informação: ela evita que o Orbit seja um proxy aberto de consulta
 * a CNPJ para quem tiver qualquer conta. Técnicos operacionais e auxiliares
 * consultam esses dados no atendimento em campo e já possuem `customers.read`.
 * A consulta não depende da permissão administrativa de cadastrar clientes.
 */
@ApiTags('Lookups')
@Controller('lookups')
/**
 * As três superfícies, declaradas.
 *
 * Sem o decorador o padrão é `['WEB','API']`, e a sessão do aplicativo seria
 * recusada — o que anularia a razão de estas rotas existirem: a web já
 * consultava CEP pelo BFF dela, e quem ficou sem busca de endereço foi
 * justamente o celular em campo.
 */
@Surfaces('WEB', 'MOBILE', 'API')
export class LookupController {
  constructor(private readonly lookups: LookupService) {}

  @Get('postal-code/:postalCode')
  @Permissions('customers.read')
  @ApiOperation({ summary: 'Endereço de um CEP, para preencher o formulário' })
  postalCode(@Param('postalCode') postalCode: string) {
    return this.lookups.postalCode(postalCode);
  }

  @Get('company/:documentNumber')
  @Permissions('customers.read')
  @ApiOperation({ summary: 'Dados cadastrais de um CNPJ' })
  company(@Param('documentNumber') documentNumber: string) {
    return this.lookups.company(documentNumber);
  }
}
