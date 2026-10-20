/// A URL que o servidor entregou, resolvida contra a API que este aparelho alcançou.
///
/// ## O problema que isto resolve
///
/// O backend devolve endereços em duas formas, e nenhuma das duas serve ao
/// aparelho como veio:
///
/// ```text
/// http://localhost:6001/api/v1/storage/objects?...   upload assinado (provedor local)
/// /api/v1/mobile/field/me/signature/preview?...      prévia da assinatura
/// ```
///
/// A primeira carrega o host de onde o **servidor** acha que vive. Num celular,
/// `localhost` é o próprio celular: o `PUT` morre em conexão recusada, e o
/// aplicativo mostra "sem internet" — numa rede que está perfeitamente boa.
///
/// A segunda já vem sem host, mas com o prefixo `/api/v1` embutido. O Dio
/// **concatena** caminho com `baseUrl` em vez de resolver por RFC, e a base já
/// termina em `/api/v1` — o pedido sai para `/api/v1/api/v1/...` e volta 404.
///
/// A web nunca sofreu disso porque sempre traduziu: ela descarta o host e mapeia
/// o prefixo para o proxy. O aplicativo confiava nos dois. Aqui ele passa a
/// traduzir também.
///
/// ## O que **não** é reescrito
///
/// Um endereço cujo caminho não começa pelo prefixo da API. É o caso do S3 ou
/// MinIO de verdade, onde o destino é outro serviço e o host é a informação
/// essencial — reescrevê-lo mandaria os bytes para o lugar errado.
///
/// O discriminador é o prefixo porque ele é o que distingue as duas coisas de
/// fato: toda URL que aponta de volta para a própria API o carrega, e nenhuma
/// URL pré-assinada de um bucket externo tem `/api/v1` no caminho.
library;

Uri resolveBackendUrl(Uri given, Uri apiBase) {
  /// A base sem barra final: `/api/v1/` e `/api/v1` descrevem o mesmo prefixo,
  /// e a diferença entre os dois só apareceria como barra dobrada no pedido.
  final prefixo = apiBase.path.endsWith('/')
      ? apiBase.path.substring(0, apiBase.path.length - 1)
      : apiBase.path;

  if (prefixo.isEmpty || !given.path.startsWith(prefixo)) return given;

  /// O que vem depois do prefixo é o caminho dentro da API. A query viaja
  /// inteira: nela estão a validade e a assinatura, e perder um parâmetro
  /// transformaria o endereço num 403 difícil de ler.
  final resto = given.path.substring(prefixo.length);

  return apiBase.replace(
    path: '$prefixo$resto',
    query: given.hasQuery ? given.query : null,
    fragment: '',
  );
}
