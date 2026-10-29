/// Cliente HTTP centralizado.
///
/// Único ponto do app que conhece a URL do backend e o formato do envelope.
/// Nenhum widget faz requisição: a UI chama providers, que chamam
/// repositories, que chamam este cliente.
///
/// O backend responde no envelope do `ResponseInterceptor`:
/// `{ success, data, requestId, timestamp }` — o cliente devolve `data` já
/// desembrulhado.
library;

import 'package:dio/dio.dart';

import '../config/environment.dart';
import '../errors/orbit_exception.dart';
import '../errors/orbit_public_copy.dart';
import '../observability/orbit_logger.dart';
import '../storage/token_storage.dart';
import 'backend_url.dart';
import 'orbit_interceptors.dart';
import 'session_authenticator.dart';

/// Transport-neutral cancellation handle for application lifecycles.
class OrbitRequestCancellation {
  final _token = CancelToken();
  bool get isCancelled => _token.isCancelled;
  void cancel() => _token.cancel();
}

class OrbitApiClient {
  OrbitApiClient._({
    required Dio dio,
    required this.authenticator,
    required Uri apiBase,
  }) : _dio = dio,
       _apiBase = apiBase;

  /// Monta o cliente com todos os interceptors na ordem correta.
  factory OrbitApiClient.create({
    required OrbitEnvironment environment,
    required TokenStorage storage,
    required OrbitLogger logger,
    String locale = 'pt-BR',
    String timezone = 'America/Recife',
    Dio? dio,
    Dio? retryDio,
  }) {
    BaseOptions options() => BaseOptions(
      baseUrl: environment.apiBaseUrl,
      connectTimeout: environment.connectTimeout,
      receiveTimeout: environment.receiveTimeout,
      contentType: Headers.jsonContentType,
      // O envelope de erro vem no corpo; deixamos o Dio entregar 4xx/5xx
      // para o mapeamento em vez de lançar antes de lermos a resposta.
      validateStatus: (status) => status != null && status < 400,
    );

    final client = dio ?? Dio(options());
    if (dio == null) client.options = options();

    // Cliente sem AuthInterceptor: usado para renovar e para reexecutar,
    // evitando recursão de interceptors.
    final plain = retryDio ?? Dio(options());
    if (retryDio == null) plain.options = options();

    final context = RequestContextInterceptor(
      locale: locale,
      timezone: timezone,
    );
    plain.interceptors.addAll([
      context,
      ErrorMappingInterceptor(destination: environment.diagnosticHost),
    ]);

    final authenticator = SessionAuthenticator(
      storage: storage,
      logger: logger,
      refreshCall: (refreshToken) async {
        final response = await plain.post<dynamic>(
          '/identity/refresh',
          data: {'refreshToken': refreshToken},
        );
        final data = _unwrap(response.data);
        if (data is! Map<String, dynamic>) {
          throw const OrbitException(
            kind: OrbitErrorKind.parse,
            publicMessage: OrbitPublicCopy.unknown,
            code: 'PARSE',
          );
        }
        return TokenPair.fromJson(data);
      },
    );

    client.interceptors.addAll([
      context,
      AuthInterceptor(
        storage: storage,
        authenticator: authenticator,
        retryClient: plain,
      ),
      LoggingInterceptor(logger),
      ErrorMappingInterceptor(destination: environment.diagnosticHost),
    ]);

    return OrbitApiClient._(
      dio: client,
      authenticator: authenticator,
      apiBase: Uri.parse(environment.apiBaseUrl),
    );
  }

  final Dio _dio;
  int? _boundGeneration;
  bool _closed = false;

  /// Feature repositories keep this lease, never a client that can switch accounts.
  OrbitApiClient scoped() => OrbitApiClient._(
    dio: _dio,
    authenticator: authenticator,
    apiBase: _apiBase,
  ).._boundGeneration = authenticator.generation;

  void closeScope() => _closed = true;

  void checkSession() {
    if (_closed ||
        (_boundGeneration != null &&
            _boundGeneration != authenticator.generation)) {
      throw SessionAuthenticator.changed;
    }
  }

  void _checkGeneration(int generation) {
    checkSession();
    if (generation != authenticator.generation) {
      throw SessionAuthenticator.changed;
    }
  }

  Map<String, dynamic> _requestExtra(bool isPublic) => {
    if (isPublic) publicRequestKey: true,
    sessionGenerationKey: authenticator.generation,
    sessionLeaseKey: () =>
        !_closed &&
        (_boundGeneration == null ||
            _boundGeneration == authenticator.generation),
  };

  /// Traduz um endereço entregue pelo servidor para um que este aparelho
  /// alcança. Ver [resolveBackendUrl].
  ///
  /// Público porque nem tudo que o servidor endereça passa por este cliente: a
  /// foto do perfil é carregada por `Image.network`, direto pelo Flutter, e
  /// precisa da mesma tradução antes de chegar lá.
  Uri resolveUrl(Uri url) => resolveBackendUrl(url, _apiBase);

  /// A API que **este aparelho** alcança.
  ///
  /// Guardada à parte de `_dio.options.baseUrl` de propósito: quando o `Dio` é
  /// injetado — em teste —, `create` não aplica as `BaseOptions`, e ler a base
  /// dali daria vazio justamente onde a tradução precisa dela.
  final Uri _apiBase;
  final SessionAuthenticator authenticator;

  Future<T> get<T>(
    String path, {
    Map<String, dynamic>? query,
    CancelToken? cancelToken,
    bool isPublic = false,
  }) => _send<T>(
    () => _dio.get<dynamic>(
      path,
      queryParameters: _clean(query),
      cancelToken: cancelToken,
      options: _options(isPublic),
    ),
  );

  /// `POST`.
  ///
  /// `headers` existe para o punhado de rotas que contrataram a idempotência
  /// no **cabeçalho** em vez de no corpo — a criação de RVT avulsa é uma
  /// delas. Não é um canal para cabeçalho arbitrário: autenticação continua
  /// sendo do interceptor, e sobrescrevê-la aqui seria contorná-lo.
  Future<T> post<T>(
    String path, {
    Object? body,
    Map<String, dynamic>? query,
    Map<String, String>? headers,
    CancelToken? cancelToken,
    bool isPublic = false,
  }) => _send<T>(
    () => _dio.post<dynamic>(
      path,
      data: body,
      queryParameters: _clean(query),
      cancelToken: cancelToken,
      options: _options(isPublic, headers: headers),
    ),
  );

  Future<T> patch<T>(String path, {Object? body, CancelToken? cancelToken}) =>
      _send<T>(
        () => _dio.patch<dynamic>(
          path,
          data: body,
          cancelToken: cancelToken,
          options: _options(false),
        ),
      );

  /// `PUT` — usado onde o backend contratou substituição, como a atualização
  /// de checklist do MB-02, que recebe o mapa de respostas inteiro.
  Future<T> put<T>(String path, {Object? body, CancelToken? cancelToken}) =>
      _send<T>(
        () => _dio.put<dynamic>(
          path,
          data: body,
          cancelToken: cancelToken,
          options: _options(false),
        ),
      );

  Future<T> delete<T>(
    String path, {
    CancelToken? cancelToken,
    bool isPublic = false,
    Map<String, String>? headers,
  }) => _send<T>(
    () => _dio.delete<dynamic>(
      path,
      cancelToken: cancelToken,
      options: _options(isPublic, headers: headers),
    ),
  );

  /// Envia um arquivo em `multipart/form-data`.
  ///
  /// O backend recebe um arquivo por requisição, no campo `file`
  /// (`FileInterceptor('file')`). O progresso é reportado enquanto o corpo
  /// sobe — é o que alimenta a barra na tela.
  Future<T> upload<T>(
    String path, {
    required String filePath,
    required String fileName,
    required String mimeType,
    CancelToken? cancelToken,
    void Function(double progress)? onProgress,
  }) async {
    checkSession();
    final generation = authenticator.generation;
    final form = FormData.fromMap({
      'file': await MultipartFile.fromFile(
        filePath,
        filename: fileName,
        contentType: DioMediaType.parse(mimeType),
      ),
    });
    _checkGeneration(generation);

    return _send<T>(
      () => _dio.post<dynamic>(
        path,
        data: form,
        cancelToken: cancelToken,
        options: _options(false),
        onSendProgress: (sent, total) {
          if (total > 0) onProgress?.call(sent / total);
        },
      ),
    );
  }

  /// Envia bytes para uma **URL assinada** do storage.
  ///
  /// É a segunda metade do pipeline de upload: o backend reserva a URL, o app
  /// põe os bytes lá, e depois confirma pela API. A URL é absoluta e de vida
  /// curta — vai sem o token da sessão, porque a própria assinatura é a
  /// credencial, e mandar o `Bearer` para fora da API seria vazá-lo.
  ///
  /// Continua passando por este cliente, e não por um `Dio` avulso: um segundo
  /// caminho de rede é como nascem dois tratamentos de erro e um deles fica
  /// para trás.
  Future<void> putBytes({
    required Uri url,
    required List<int> bytes,
    required Map<String, String> headers,
    CancelToken? cancelToken,
    void Function(double progress)? onProgress,
  }) async {
    checkSession();
    final generation = authenticator.generation;
    try {
      await _dio.putUri<dynamic>(
        resolveBackendUrl(url, _apiBase),
        data: Stream<List<int>>.value(bytes),
        cancelToken: cancelToken,
        onSendProgress: (sent, total) {
          if (total > 0) onProgress?.call(sent / total);
        },
        options: Options(
          headers: {...headers, Headers.contentLengthHeader: bytes.length},

          /// Sem interceptor de sessão: a URL assinada é a credencial.
          extra: _requestExtra(true),
        ),
      );
      _checkGeneration(generation);
    } on DioException catch (error) {
      _checkGeneration(generation);
      final mapped = error.error;
      if (mapped is OrbitException) throw mapped;

      /// A mensagem do Dio carrega URI, host e porta. Ela nunca vira texto
      /// público — o que sobe é a frase do aplicativo, e o endereço vai para o
      /// diagnóstico.
      throw OrbitException(
        kind: OrbitErrorKind.network,
        publicMessage: OrbitPublicCopy.offline,
        code: 'UPLOAD',
        diagnostics: _diagnosticar(error),
      );
    }
  }

  /// Busca bytes de uma **URL assinada** do storage.
  ///
  /// O par de `putBytes`: a URL é absoluta e de vida curta, e vai sem o token
  /// da sessão porque a própria assinatura é a credencial. Continua passando
  /// por este cliente para não existir um segundo caminho de rede com um
  /// segundo tratamento de erro.
  Future<({List<int> bytes, String? contentType, String? fileName})> getBytes({
    required Uri url,
    Map<String, String> headers = const {},
    CancelToken? cancelToken,
    OrbitRequestCancellation? cancellation,
    int? maxBytes,
    bool isPublic = true,
    void Function(double progress)? onProgress,
  }) async {
    checkSession();
    final generation = authenticator.generation;
    final boundedToken = cancellation?._token ?? cancelToken ?? CancelToken();
    try {
      final response = await _dio.getUri<List<int>>(
        resolveBackendUrl(url, _apiBase),
        cancelToken: boundedToken,
        onReceiveProgress: (received, total) {
          if (maxBytes != null && (received > maxBytes || total > maxBytes)) {
            boundedToken.cancel();
          }
          if (total > 0) onProgress?.call(received / total);
        },
        options: Options(
          headers: headers.isEmpty ? null : headers,
          responseType: ResponseType.bytes,

          /// Sem interceptor de sessão: a URL assinada é a credencial.
          extra: _requestExtra(isPublic),
        ),
      );
      _checkGeneration(generation);
      if (maxBytes != null && (response.data?.length ?? 0) > maxBytes) {
        throw const OrbitException(
          kind: OrbitErrorKind.parse,
          publicMessage: OrbitPublicCopy.unknown,
          code: 'RESULT_TOO_LARGE',
        );
      }
      return (
        bytes: response.data ?? const <int>[],
        contentType: response.headers.value(Headers.contentTypeHeader),

        /// O nome publicado pelo servidor, quando ele o envia. É o nome que a
        /// pessoa vai ver ao abrir ou compartilhar — melhor do que qualquer
        /// coisa que o app invente.
        fileName: _dispositionFileName(
          response.headers.value('content-disposition'),
        ),
      );
    } on DioException catch (error) {
      _checkGeneration(generation);
      final mapped = error.error;
      if (mapped is OrbitException) throw mapped;
      throw OrbitException(
        kind: OrbitErrorKind.network,
        publicMessage: OrbitPublicCopy.offline,
        code: 'DOWNLOAD',
        diagnostics: _diagnosticar(error),
      );
    }
  }

  /// Extrai o nome de `Content-Disposition`.
  ///
  /// Prefere `filename*` (RFC 5987, com codificação declarada) e cai para
  /// `filename`. Devolve só o nome, sem caminho: um cabeçalho é entrada
  /// externa, e `../` vindo dele não pode virar caminho de gravação.
  static String? _dispositionFileName(String? header) {
    if (header == null) return null;

    final extended = RegExp(
      r"filename\*=(?:[^']*)'(?:[^']*)'([^;]+)",
      caseSensitive: false,
    ).firstMatch(header);
    final plain = RegExp(
      r'filename="?([^";]+)"?',
      caseSensitive: false,
    ).firstMatch(header);

    final raw = extended?.group(1) ?? plain?.group(1);
    if (raw == null) return null;

    final decoded = Uri.decodeComponent(raw.trim());
    final name = decoded.split(RegExp(r'[/\\]')).last.trim();
    return name.isEmpty || name == '.' || name == '..' ? null : name;
  }

  Options _options(bool isPublic, {Map<String, String>? headers}) =>
      Options(extra: _requestExtra(isPublic), headers: headers);

  /// Remove chaves nulas ou vazias — o `ValidationPipe` do backend usa
  /// `forbidNonWhitelisted` e rejeita parâmetros vazios.
  Map<String, dynamic>? _clean(Map<String, dynamic>? query) {
    if (query == null) return null;
    final cleaned = <String, dynamic>{};
    query.forEach((key, value) {
      if (value == null) return;
      if (value is String && value.isEmpty) return;
      cleaned[key] = value;
    });
    return cleaned.isEmpty ? null : cleaned;
  }

  Future<T> _send<T>(Future<Response<dynamic>> Function() request) async {
    checkSession();
    final generation = authenticator.generation;
    try {
      final response = await request();
      _checkGeneration(generation);
      return _unwrap(response.data) as T;
    } on DioException catch (error) {
      _checkGeneration(generation);
      final mapped = error.error;
      if (mapped is OrbitException) throw mapped;

      /// Rede de segurança: o interceptor já deveria ter traduzido. Se chegou
      /// aqui cru, o que sobe continua sendo a frase do aplicativo — nunca
      /// `error.message`, que é onde a biblioteca escreve o endereço.
      throw OrbitException(
        kind: OrbitErrorKind.network,
        publicMessage: OrbitPublicCopy.offline,
        code: 'NETWORK',
        diagnostics: _diagnosticar(error),
      );
    }
  }

  /// O que a falha diz para o log — e só para ele.
  OrbitDiagnostics _diagnosticar(DioException error) => OrbitDiagnostics(
    transport: error.type.name,
      path: OrbitLogger.safePath(error.requestOptions.path),
    statusCode: error.response?.statusCode,
    cause: error.error,
  );

  /// Extrai `data` do envelope; respostas sem envelope passam direto.
  static Object? _unwrap(Object? body) {
    if (body is Map<String, dynamic> &&
        body.containsKey('success') &&
        body.containsKey('data')) {
      return body['data'];
    }
    return body;
  }
}
