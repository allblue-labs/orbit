import {
  Body,
  Controller,
  Get,
  Headers,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../decorators';
import { ValidationException } from '../../exceptions';
import { SignPmocContractDto } from './pmoc.dto';
import { PmocService } from './pmoc.service';

/**
 * O contrato do PMOC visto por quem vai assiná-lo.
 *
 * ## Por que um controller separado
 *
 * Porque a autoridade é outra. Todo o resto do PMOC exige sessão, capability de plano
 * e permissão; aqui quem chama é o contratante, que não tem conta — a credencial é o
 * token do link, e ela vale para **um** contrato. Misturar as duas coisas no mesmo
 * controller deixaria `@Public()` ao lado de rotas que nunca podem ser públicas, e um
 * decorador esquecido numa delas abriria a organização inteira.
 *
 * Nenhum `@Capabilities` e nenhum `@RequiresActivePlan`: o contratante não é do plano
 * de ninguém, e um contrato já enviado não deve parar de abrir porque a assinatura da
 * organização venceu.
 *
 * ## O token não aparece em log
 *
 * Ele vem no caminho, e o interceptor de log registra caminhos. É uma troca
 * consciente: o alternativo seria recebê-lo no corpo de um `GET`, que nem todo cliente
 * HTTP permite. O que o log vê é o hash de nada — o token em claro —, então a
 * mitigação real é a validade curta e a revogação ao gerar outro.
 */
@ApiTags('PMOC — contrato público')
@Controller('public/pmoc/contracts')
export class PmocPublicContractController {
  constructor(private readonly pmoc: PmocService) {}

  @Get(':token')
  @Public()
  @ApiOperation({ summary: 'O resumo do contrato que o link abre' })
  read(@Param('token') token: string) {
    return this.pmoc.publicContract(token);
  }

  /**
   * Registra a assinatura do contratante.
   *
   * `Ip` e o `User-Agent` entram como evidência: não identificam ninguém sozinhos, e
   * são o que sobra para contestar uma assinatura meses depois.
   */
  @Post(':token/signature')
  @Public()
  @ApiOperation({ summary: 'Coleta a assinatura digital do contratante' })
  sign(
    @Param('token') token: string,
    @Body() input: SignPmocContractDto,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.pmoc.signPublicContract(token, {
      signerName: input.signerName,
      signerDocument: input.signerDocument,
      signerEmail: input.signerEmail,
      signature: decodePng(input.signatureBase64),
      mimeType: 'image/png',
      ip,
      userAgent,
    });
  }
}

/** O cabeçalho de um PNG: `\x89PNG\r\n\x1a\n`. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Os bytes da assinatura, conferidos antes de serem guardados.
 *
 * ## Por que não basta `Buffer.from(base64)`
 *
 * Porque `Buffer.from` nunca falha: qualquer texto vira bytes, e o que não é base64
 * vira lixo silenciosamente. O resultado seria um `storage_files` apontando para um
 * objeto que o PDFKit recusa — e a recusa aparece meses depois, na emissão do
 * contrato, longe de onde o erro foi cometido.
 *
 * Conferir o cabeçalho PNG é o que garante que o arquivo é imagem — e, de graça, que
 * o base64 era válido: texto que não é base64 produz bytes que não começam com a
 * assinatura do formato. O compositor do documento só desenha PNG e JPEG, e aceitar
 * outra coisa aqui seria aceitar uma assinatura que nunca vai sair impressa.
 */
function decodePng(base64: string): Buffer {
  /* O prefixo `data:` é o que o `canvas.toDataURL` do navegador produz; aceitá-lo
     evita exigir que a tela o remova — e exigir isso é como se esquece. */
  const limpo = base64.replace(/^data:image\/png;base64,/, '');

  const bytes = Buffer.from(limpo, 'base64');
  if (bytes.byteLength === 0) {
    throw new ValidationException('A assinatura chegou vazia');
  }
  if (!bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) {
    throw new ValidationException('A assinatura precisa ser uma imagem PNG');
  }
  return bytes;
}
