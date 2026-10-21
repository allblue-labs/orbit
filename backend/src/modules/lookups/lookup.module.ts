import { Module } from '@nestjs/common';
import { LookupController } from './lookup.controller';
import { LookupService } from './lookup.service';

/**
 * Consultas públicas de apoio ao cadastro.
 *
 * Sem banco e sem repositório: nada daqui é persistido. O módulo existe para
 * que o aplicativo e a web consultem CEP e CNPJ pelo mesmo caminho, com o mesmo
 * vocabulário e o mesmo tratamento de indisponibilidade.
 */
@Module({
  controllers: [LookupController],
  providers: [LookupService],
  exports: [LookupService],
})
export class LookupModule {}
