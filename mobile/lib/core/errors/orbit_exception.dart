/// Erros normalizados da API.
///
/// ## Dois canais, e a razão de existirem
///
/// Uma falha carrega duas coisas que **não** podem viver no mesmo campo:
///
/// ```text
/// publicMessage   o que a pessoa lê        → sempre seguro
/// diagnostics     o que o desenvolvedor lê → nunca vai para a tela
/// ```
///
/// Esta separação nasceu de um incidente: a mensagem pública era montada com
/// `'$mensagem (tentei $destino)'`, e um técnico abriu o aplicativo e recebeu
/// **"O servidor demorou a responder. (tentei 10.0.2.2:6001)"**. O endereço do
/// backend não é assunto de quem usa o aplicativo — nem em desenvolvimento,
/// porque a mesma tela é a de produção, e a proteção que depende do ambiente
/// falha no dia em que o ambiente é lido errado.
///
/// A correção não foi apertar o `if (isProduction)`. Foi tirar o diagnóstico do
/// caminho da apresentação: hoje ele mora num objeto à parte, que a interface
/// não recebe e não sabe imprimir.
///
/// ## O nome diz o contrato
///
/// O campo se chama `publicMessage`, e não `message`. Um campo chamado
/// `message` convida a escrever qualquer coisa nele; um chamado
/// `publicMessage` faz quem for concatenar um host pensar duas vezes.
///
/// ## O formato do backend
///
/// `{ success: false, error: { code, message, details }, requestId, timestamp }`
/// — o `FoundationExceptionFilter` do NestJS (PR-35). A `message` de lá **já é
/// pública e sanitizada**; o `code` é a autoridade de máquina, e nenhuma
/// decisão deste aplicativo lê o texto para descobrir o que aconteceu.
library;

import 'orbit_public_copy.dart';

/// A natureza da falha, do ponto de vista de quem precisa reagir a ela.
///
/// Pequena de propósito: é a taxonomia do Orbit, não um espelho dos enums do
/// Dio. Dio é detalhe de implementação, e um enum que o copia obriga a mexer
/// aqui a cada versão dele.
enum OrbitErrorKind {
  /// O servidor respondeu, com o contrato de erro publicado.
  http,

  /// Sem rede, ou o servidor inalcançável. O aparelho pode estar num subsolo.
  network,

  /// A conexão abriu e a resposta não veio a tempo.
  timeout,

  /// O próprio aplicativo cancelou. Normalmente não é erro para ninguém ver.
  cancelled,

  /// A resposta veio, mas não no formato contratado.
  parse,

  /// Sessão inválida ou expirada.
  unauthorized,

  /// A conexão segura não pôde ser estabelecida.
  insecure,
}

/// O que aconteceu por baixo — para log e suporte, nunca para a tela.
///
/// Existe como classe própria, e não como campos soltos em [OrbitException],
/// justamente para que ninguém a interpole por descuido: um objeto que a
/// interface não recebe é um objeto que a interface não imprime.
class OrbitDiagnostics {
  const OrbitDiagnostics({
    this.transport,
    this.host,
    this.path,
    this.statusCode,
    this.cause,
  });

  /// O tipo técnico da falha de transporte, como o cliente HTTP o chamou.
  final String? transport;

  /// Para onde se tentou ir, como `10.0.2.2:6001`.
  ///
  /// É o dado mais útil quando a conexão nem abre — quase sempre a URL está
  /// errada, não a rede. Fica aqui, onde o desenvolvedor o encontra no log.
  final String? host;

  /// O caminho da rota. **Sem query string**: identificadores e filtros vão
  /// nela, e um log não precisa deles para correlacionar com o servidor.
  final String? path;

  final int? statusCode;

  /// O erro original, para o `stackTrace` do log.
  final Object? cause;

  Map<String, Object?> toLog() => {
    if (transport != null) 'transport': transport,
    if (host != null) 'host': host,
    if (path != null) 'path': path,
    if (statusCode != null) 'status': statusCode,
  };

  @override
  String toString() => 'OrbitDiagnostics(${toLog()})';
}

class OrbitException implements Exception {
  const OrbitException({
    required this.kind,
    required this.publicMessage,
    this.status = 0,
    this.code = 'UNKNOWN',
    this.requestId,
    this.details,
    this.diagnostics,
  });

  final OrbitErrorKind kind;

  /// **O único campo que a interface pode mostrar.**
  ///
  /// Vem de duas origens, e as duas são seguras: a `message` do contrato do
  /// backend, que já é pública e sanitizada, ou uma das frases fixas deste
  /// aplicativo para falhas de transporte. Nunca de texto de biblioteca.
  final String publicMessage;

  final int status;
  final String code;
  final String? requestId;
  final Object? details;

  /// Nulo quando não há o que diagnosticar. Nunca chega à apresentação.
  final OrbitDiagnostics? diagnostics;

  bool get isUnauthorized =>
      status == 401 || kind == OrbitErrorKind.unauthorized;
  bool get isForbidden => status == 403;
  bool get isNotFound => status == 404;
  bool get isConflict => status == 409;
  bool get isValidation => status == 400 || status == 422;
  bool get isServer => status >= 500;
  bool get isOffline => kind == OrbitErrorKind.network;
  bool get isCancelled => kind == OrbitErrorKind.cancelled;

  /// Vale tentar de novo sozinho?
  ///
  /// Falta de rede, demora e indisponibilidade passam; permissão negada e
  /// conflito de dados não passam por insistência. Cancelamento foi decisão do
  /// próprio aplicativo — repetir seria desfazer o que ele pediu.
  bool get isRetryable => switch (kind) {
    OrbitErrorKind.network || OrbitErrorKind.timeout => true,
    OrbitErrorKind.cancelled ||
    OrbitErrorKind.unauthorized ||
    OrbitErrorKind.insecure => false,
    OrbitErrorKind.parse => false,
    OrbitErrorKind.http => status >= 500 || status == 429,
  };

  /// A requisição pode ter sido processada apesar da falha?
  ///
  /// ## Por que a pergunta importa
  ///
  /// Dizer "falhou" quando o servidor concluiu o atendimento leva alguém a
  /// concluí-lo de novo. Dizer "pode ter dado certo" quando nada saiu do
  /// aparelho deixa a pessoa parada esperando algo que não aconteceu. As duas
  /// mentiras custam caro, e o transporte sabe distinguir os casos.
  ///
  /// ## A distinção
  ///
  /// ```text
  /// connectionTimeout   a conexão nem abriu    → nada foi enviado
  /// sendTimeout         enviando quando parou  → pode ter chegado
  /// receiveTimeout      enviado, sem resposta  → provavelmente processou
  /// 5xx                 o servidor recebeu     → pode ter processado
  /// sem rede / recusada nada saiu do aparelho  → nada foi enviado
  /// ```
  bool get mayHaveBeenApplied {
    if (status >= 500) return true;
    return switch (diagnostics?.transport) {
      'sendTimeout' || 'receiveTimeout' => true,
      _ => false,
    };
  }

  /// A mensagem quando a falha aconteceu **durante um comando**.
  ///
  /// Só difere de [publicMessage] no caso ambíguo — e ali a diferença é o que
  /// separa "tente de novo" de "confira antes de tentar de novo".
  String get publicMessageForCommand =>
      mayHaveBeenApplied ? OrbitPublicCopy.resultUnknown : publicMessage;

  /// Mensagens seguras do contrato estruturado de validação.
  List<String> get validationMessages {
    final value = details;
    if (value is List) {
      return value
          .map(
            (item) => switch (item) {
              final String message => message,
              final Map issue when issue['message'] is String =>
                issue['message'] as String,
              _ => null,
            },
          )
          .whereType<String>()
          .toList(growable: false);
    }
    return const [];
  }

  /// Interpreta o corpo de erro do backend.
  ///
  /// Só aceita o **contrato**. Um corpo que não é mapa — HTML de proxy, texto
  /// de gateway, resposta truncada — não vira mensagem: vira a frase genérica
  /// deste aplicativo. Renderizar "502 Bad Gateway / nginx" para um técnico em
  /// campo não informa nada e expõe a topologia da infraestrutura.
  factory OrbitException.fromEnvelope({
    required int status,
    required Object? body,
    String? requestId,
    OrbitDiagnostics? diagnostics,
  }) {
    if (body is! Map) {
      return OrbitException(
        kind: OrbitErrorKind.http,
        status: status,
        publicMessage: publicCopyForStatus(status),
        code: _defaultCode(status),
        requestId: requestId,
        diagnostics: diagnostics,
      );
    }
    final error = body['error'];

    /// A mensagem só é aceita de dentro de `error` — o lugar que o contrato
    /// define. Um `message` na raiz pode ser de um proxy que também fala JSON.
    final rawMessage = error is Map ? error['message'] : null;
    final message = switch (rawMessage) {
      final String value when value.trim().isNotEmpty => value,
      final List<dynamic> values when values.isNotEmpty =>
        values.whereType<String>().join(' '),
      _ => publicCopyForStatus(status),
    };
    return OrbitException(
      kind: OrbitErrorKind.http,
      status: status,
      publicMessage: message.trim().isEmpty
          ? publicCopyForStatus(status)
          : message,
      code:
          (error is Map ? error['code'] as String? : null) ??
          _defaultCode(status),
      requestId: (body['requestId'] as String?) ?? requestId,
      details: error is Map ? error['details'] : null,
      diagnostics: diagnostics,
    );
  }

  static String _defaultCode(int status) => switch (status) {
    401 => 'UNAUTHORIZED',
    403 => 'FORBIDDEN',
    404 => 'NOT_FOUND',
    409 => 'CONFLICT',
    429 => 'TOO_MANY_REQUESTS',
    _ => status >= 500 ? 'INTERNAL_SERVER_ERROR' : 'HTTP_ERROR',
  };

  /// A frase deste aplicativo quando o servidor não deu uma.
  ///
  /// A frase segura para um `catch` que pegou qualquer coisa.
  ///
  /// ## Por que isto existe
  ///
  /// Um `on Object catch (error)` numa tela é honesto: a câmera, o disco e o
  /// codec de imagem falham de formas que não passam pelo Dio e nunca viram
  /// uma [OrbitException]. O que não é honesto é interpolar esse objeto no
  /// texto. `'Não foi possível registrar: $error'` publica
  /// `PlatformException`, `SocketException` e, no pior caso, o endereço do
  /// servidor — o incidente que este arquivo existe para impedir, entrando
  /// pela porta dos fundos.
  ///
  /// [prefixo] permite dizer *o que* falhou sem dizer *como*.
  static String publicCopyForAny(Object? error, {String? prefixo}) {
    final frase = error is OrbitException
        ? error.publicMessage
        : OrbitPublicCopy.unknown;
    return prefixo == null ? frase : '$prefixo $frase';
  }

  /// Nenhum número de status aparece: "HTTP 502" não diz a ninguém o que
  /// fazer, e quem sabe o que significa não precisa que a tela conte.
  static String publicCopyForStatus(int status) => switch (status) {
    401 => 'Sua sessão expirou. Entre novamente para continuar.',
    403 => 'Você não tem permissão para realizar esta ação.',
    404 => 'Este registro não está disponível.',
    409 => 'Os dados foram alterados. Atualize e tente novamente.',
    429 => 'Muitas tentativas. Tente novamente em alguns instantes.',
    >= 500 =>
      'Não foi possível acessar o Orbit agora. '
          'Tente novamente em alguns instantes.',
    _ => 'Não foi possível concluir esta ação. Tente novamente.',
  };

  /// Sem o texto público e sem diagnóstico.
  ///
  /// `toString` acaba em log, em `print` de teste e em relatório de erro
  /// automático. Colocar aqui o endereço do servidor devolveria pela janela o
  /// que a separação tirou pela porta.
  @override
  String toString() => 'OrbitException($code, status: $status)';
}
