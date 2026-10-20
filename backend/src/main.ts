import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
/* `useBodyParser` é do adaptador Express, e não da interface genérica. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApiVersioning } from './configure-api';
import { validateReleaseEnvironment } from './release-environment';

async function bootstrap() {
  validateReleaseEnvironment(process.env);
  /**
   * O corpo é interpretado por parsers que este arquivo registra, e não pelos
   * padrões do Nest.
   *
   * ## Por que `bodyParser: false`
   *
   * Duas exigências se encontram aqui. `rawBody` guarda os bytes originais além
   * do JSON interpretado — o webhook de cobrança verifica a assinatura sobre
   * exatamente o que chegou, e reserializar o JSON muda espaços, ordem de chaves
   * e escapes, fazendo a assinatura falhar para eventos legítimos. E o limite de
   * tamanho precisa caber a logo da unidade, que chega como data URI.
   *
   * O padrão do Express são 100 KB. Havia aqui um `app.use(regex, json(...))`
   * tentando abrir mais espaço só no caminho da marca. **Não funcionava e
   * quebrava tudo**: com `bodyParser: true` o parser do Nest já está registrado
   * quando esta linha roda, então ele interpretava o corpo primeiro — o limite
   * maior nunca valia para ninguém — e o segundo parser sobre o mesmo pedido
   * deixava `req.body` vazio em **todas** as rotas. O login passou a responder
   * 400 com "informe um e-mail válido" para credenciais corretas, porque não
   * chegava campo nenhum.
   *
   * Registrando aqui, o limite é um só, declarado, e o `rawBody` continua: o
   * Nest o repassa de `appOptions` para `useBodyParser`.
   *
   * ## Por que 1 MB
   *
   * É o teto da imagem embutida traduzido para o corpo que a carrega.
   * `readEmbeddedImage` recusa imagem acima de 512 KB, e 512 KB em base64 são
   * ~683 KB — com o limite em 100 KB, a política de imagem declarava um teto
   * que o parser tornava inalcançável, e o cliente recebia 413 sem explicação.
   * Quem decide o que é imagem grande continua sendo `readEmbeddedImage`, que
   * recusa com mensagem; este limite é a primeira barreira, não a única.
   */
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

  configureApiVersioning(app);
  app.enableShutdownHooks();
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  await app.listen(
    Number(process.env.PORT ?? 3001),
    process.env.HOST ?? '0.0.0.0',
  );
}
void bootstrap();
