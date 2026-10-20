/// Interceptors do cliente HTTP.
///
/// Cada um faz uma coisa só, na ordem em que o Dio os executa:
///
/// 1. [RequestContextInterceptor] — identifica e contextualiza a requisição;
/// 2. [AuthInterceptor] — anexa o token e renova a sessão no 401;
/// 3. [LoggingInterceptor] — registra sem vazar segredo;
/// 4. [ErrorMappingInterceptor] — traduz falhas para [OrbitException].
library;

import 'dart:math';

import 'package:dio/dio.dart';

import 'dart:io' show HandshakeException, TlsException;

import '../errors/orbit_exception.dart';
import '../errors/orbit_public_copy.dart';
import '../observability/orbit_logger.dart';
import '../storage/token_storage.dart';
import 'session_authenticator.dart';

/// Marca requisições que não devem levar token nem disparar renovação.
const publicRequestKey = 'orbit.public';

/// Cabeçalhos de contexto — os mesmos nomes usados pela aplicação web.
abstract final class ContextHeaders {
  static const requestId = 'x-request-id';
  static const locale = 'accept-language';
  static const timezone = 'x-timezone';
  static const client = 'x-orbit-client';
}

/// Gera `x-request-id` e envia locale e timezone.
///
/// O `RequestIdInterceptor` do NestJS aceita o id que enviamos e o devolve na
/// resposta — é o que permite casar um erro no aparelho com o log do servidor.
class RequestContextInterceptor extends Interceptor {
  RequestContextInterceptor({required this.locale, required this.timezone});

  final String locale;
  final String timezone;

  static final _random = Random.secure();

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.headers[ContextHeaders.requestId] ??= newRequestId();
    options.headers[ContextHeaders.locale] ??= locale;
    options.headers[ContextHeaders.timezone] ??= timezone;
    options.headers[ContextHeaders.client] ??= 'MOBILE';
    handler.next(options);
  }

  /// UUID v4 para correlação ponta a ponta.
  static String newRequestId() {
    final bytes = List<int>.generate(16, (_) => _random.nextInt(256));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${hex.substring(0, 8)}-${hex.substring(8, 12)}-'
        '${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}';
  }
}

/// Anexa o access token e renova a sessão quando o backend responde 401.
class AuthInterceptor extends QueuedInterceptor {
  AuthInterceptor({
    required TokenStorage storage,
    required SessionAuthenticator authenticator,
    required Dio retryClient,
  }) : _storage = storage,
       _authenticator = authenticator,
       _retryClient = retryClient;

  final TokenStorage _storage;
  final SessionAuthenticator _authenticator;

  /// Cliente sem este interceptor, para reexecutar sem recursão.
  final Dio _retryClient;

  @override
  Future<void> onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    if (options.extra[publicRequestKey] == true) return handler.next(options);
    final tokens = await _storage.read();
    if (tokens != null) {
      options.headers['authorization'] = 'Bearer ${tokens.accessToken}';
    }
    handler.next(options);
  }

  @override
  Future<void> onError(
    DioException err,
    ErrorInterceptorHandler handler,
  ) async {
    final options = err.requestOptions;
    final isPublic = options.extra[publicRequestKey] == true;
    final alreadyRetried = options.extra['orbit.retried'] == true;

    if (err.response?.statusCode != 401 || isPublic || alreadyRetried) {
      return handler.next(err);
    }

    final tokens = await _storage.read();
    if (tokens == null) return handler.next(err);

    final renewed = await _authenticator.refresh(tokens.refreshToken);
    if (renewed == null) return handler.next(err);

    try {
      final response = await _retryClient.fetch<dynamic>(
        options
          ..headers['authorization'] = 'Bearer ${renewed.accessToken}'
          ..extra['orbit.retried'] = true,
      );
      handler.resolve(response);
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }
}

/// Registra a requisição sem expor segredo.
class LoggingInterceptor extends Interceptor {
  LoggingInterceptor(this._logger);

  final OrbitLogger _logger;

  static const _startKey = 'orbit.startedAt';

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    options.extra[_startKey] = DateTime.now();
    handler.next(options);
  }

  @override
  void onResponse(
    Response<dynamic> response,
    ResponseInterceptorHandler handler,
  ) {
    _log(response.requestOptions, response.statusCode);
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    /// O endereço vai para o log, e é aqui que ele deve estar.
    ///
    /// Quando a conexão nem abre, "para onde tentei ir" é o que resolve o
    /// chamado — e a tela deixou de ser o lugar de contar isso.
    _log(
      err.requestOptions,
      err.response?.statusCode,
      error: err.type.name,
      host: err.requestOptions.uri.host.isEmpty
          ? null
          : '${err.requestOptions.uri.host}:${err.requestOptions.uri.port}',
    );
    handler.next(err);
  }

  void _log(
    RequestOptions options,
    int? status, {
    String? error,
    String? host,
  }) {
    final startedAt = options.extra[_startKey];
    final duration = startedAt is DateTime
        ? DateTime.now().difference(startedAt).inMilliseconds
        : null;
    // Sem corpo, sem query com identificadores, sem cabeçalhos.
    _logger.info(
      'http',
      data: {
        'method': options.method,
        'path': options.path,
        'status': status,
        'durationMs': duration,
        'requestId': options.headers[ContextHeaders.requestId],
        if (error != null) 'error': error,
        if (host != null) 'host': host,
      },
    );
  }
}

/// Traduz qualquer falha do Dio para [OrbitException].
///
/// ## A fronteira
///
/// Daqui para cima ninguém mais conhece Dio. `DioException`, `SocketException`
/// e `HandshakeException` morrem nesta classe, e o que sobe é a taxonomia do
/// Orbit — pequena, estável e independente da biblioteca.
///
/// ## O host não entra na mensagem
///
/// Ele entra em [OrbitDiagnostics], que a apresentação não recebe. A versão
/// anterior concatenava `'(tentei $destino)'` na mensagem pública, e foi assim
/// que um técnico viu `10.0.2.2:6001` na tela ao abrir o aplicativo. A proteção
/// não pode depender do ambiente: a mesma tela roda em desenvolvimento e em
/// produção, e o `if` que separa os dois é exatamente o que falha quando o
/// ambiente é lido errado.
class ErrorMappingInterceptor extends Interceptor {
  ErrorMappingInterceptor({this.destination});

  /// Para onde o cliente foi configurado a falar, como `10.0.2.2:6001`.
  ///
  /// Vai para o **diagnóstico**, nunca para a tela. Quando a conexão nem abre,
  /// é o dado que resolve o problema — e quem precisa dele lê o log, não a
  /// mensagem de erro do técnico em campo.
  final String? destination;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    handler.reject(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: map(err),
      ),
    );
  }

  /// A tradução, isolada do encanamento do Dio.
  ///
  /// Pública porque é **o** comportamento desta classe, e é o que precisa ser
  /// verificado caso a caso. Exercitá-la através de `onError` exigiria fabricar
  /// um handler do Dio, e o teste passaria a medir o handler.
  OrbitException map(DioException err) {
    final requestId =
        err.response?.headers.value(ContextHeaders.requestId) ??
        err.requestOptions.headers[ContextHeaders.requestId] as String?;

    final diagnostics = OrbitDiagnostics(
      transport: err.type.name,
      host: destination,

      /// Só o caminho. A query carrega identificadores e filtros, e nada disso
      /// é necessário para correlacionar com o log do servidor.
      path: err.requestOptions.path,
      statusCode: err.response?.statusCode,
      cause: err.error,
    );

    /// A conexão segura é olhada **antes** do tipo do Dio.
    ///
    /// Uma falha de handshake chega como `connectionError` ou `unknown`, e
    /// tratá-la como "sem conexão" mandaria a pessoa conferir o wi-fi por um
    /// problema que não é dela. O certificado é outra conversa.
    if (_ehFalhaDeConexaoSegura(err.error)) {
      return OrbitException(
        kind: OrbitErrorKind.insecure,
        publicMessage: OrbitPublicCopy.secureConnectionFailed,
        code: 'SECURE_CONNECTION_FAILED',
        requestId: requestId,
        diagnostics: diagnostics,
      );
    }

    return switch (err.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout => OrbitException(
        kind: OrbitErrorKind.timeout,
        publicMessage: OrbitPublicCopy.timeout,
        code: 'TIMEOUT',
        requestId: requestId,
        diagnostics: diagnostics,
      ),

      /// Cancelamento é decisão do próprio aplicativo — a tela saiu, o usuário
      /// voltou. Continua sendo um erro para quem chamou, com texto neutro
      /// caso alguém insista em mostrá-lo.
      DioExceptionType.cancel => OrbitException(
        kind: OrbitErrorKind.cancelled,
        publicMessage: OrbitPublicCopy.cancelled,
        code: 'REQUEST_CANCELLED',
        requestId: requestId,
        diagnostics: diagnostics,
      ),

      DioExceptionType.badCertificate => OrbitException(
        kind: OrbitErrorKind.insecure,
        publicMessage: OrbitPublicCopy.secureConnectionFailed,
        code: 'SECURE_CONNECTION_FAILED',
        requestId: requestId,
        diagnostics: diagnostics,
      ),

      DioExceptionType.connectionError ||
      DioExceptionType.unknown when err.response == null => OrbitException(
        kind: OrbitErrorKind.network,
        publicMessage: OrbitPublicCopy.offline,
        code: 'NETWORK',
        requestId: requestId,
        diagnostics: diagnostics,
      ),

      _ => OrbitException.fromEnvelope(
        status: err.response?.statusCode ?? 0,
        body: err.response?.data,
        requestId: requestId,
        diagnostics: diagnostics,
      ),
    };
  }

  /// O erro por baixo é de TLS?
  ///
  /// A checagem é pelo **tipo** e pelo nome da classe, não pelo texto: ler
  /// `message.contains('CERTIFICATE')` é a mesma dependência frágil de string
  /// que este arquivo existe para eliminar. `HandshakeException` é o tipo do
  /// `dart:io`; o nome cobre implementações que não o usam diretamente.
  static bool _ehFalhaDeConexaoSegura(Object? cause) {
    if (cause is HandshakeException) return true;
    if (cause is TlsException) return true;
    final nome = cause?.runtimeType.toString() ?? '';
    return nome == 'HandshakeException' || nome == 'CertificateException';
  }
}
