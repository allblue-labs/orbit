/// Log da aplicação.
///
/// Regra dura: **nada sensível sai daqui**. Tokens, senhas, cookies e corpos de
/// requisição nunca são registrados. O que se registra é o suficiente para
/// correlacionar com o backend — método, rota, status, duração e `requestId`,
/// que é o mesmo id que o NestJS grava nos logs dele.
library;

import 'dart:developer' as developer;

import '../config/environment.dart';

enum LogLevel { debug, info, warning, error }

/// Chaves cujo valor jamais é impresso, em qualquer nível.
const _redactedKeys = <String>{
  'authorization',
  'password',
  'accesstoken',
  'refreshtoken',
  'token',
  'cookie',
  'set-cookie',
  'secret',
  'mfacode',
  'signature',
  'x-amz-signature',
  'x-goog-signature',
};

class OrbitLogger {
  const OrbitLogger({required this.isProduction});

  factory OrbitLogger.forEnvironment(OrbitEnvironment environment) =>
      OrbitLogger(isProduction: environment.isProduction);

  final bool isProduction;

  /// RequestOptions.path pode conter uma URL absoluta, query e credenciais.
  /// Mantém só o caminho, inclusive quando a URI não puder ser interpretada.
  static String safePath(String value) {
    final withoutParameters = value.split(RegExp(r'[?#]')).first;
    final uri = Uri.tryParse(withoutParameters);
    return uri?.path ?? '[caminho indisponível]';
  }

  void debug(String message, {Map<String, Object?>? data}) {
    if (isProduction) return; // ruído de desenvolvimento não vai para produção
    _emit(LogLevel.debug, message, data);
  }

  void info(String message, {Map<String, Object?>? data}) =>
      _emit(LogLevel.info, message, data);

  void warning(String message, {Map<String, Object?>? data}) =>
      _emit(LogLevel.warning, message, data);

  void error(
    String message, {
    Object? error,
    StackTrace? stackTrace,
    Map<String, Object?>? data,
  }) {
    _emit(LogLevel.error, message, data, error: error, stackTrace: stackTrace);
  }

  void _emit(
    LogLevel level,
    String message,
    Map<String, Object?>? data, {
    Object? error,
    StackTrace? stackTrace,
  }) {
    developer.log(
      data == null || data.isEmpty ? message : '$message ${redact(data)}',
      name: 'orbit.${level.name}',
      level: switch (level) {
        LogLevel.debug => 500,
        LogLevel.info => 800,
        LogLevel.warning => 900,
        LogLevel.error => 1000,
      },
      // Objetos de transporte podem imprimir URLs assinadas, corpos e headers.
      // Registra o tipo; detalhes autorizados devem entrar no mapa redigido.
      error: error?.runtimeType.toString(),
      stackTrace: stackTrace,
    );
  }

  /// Substitui valores sensíveis por `***`, inclusive em mapas aninhados.
  static Map<String, Object?> redact(Map<String, Object?> data) {
    return data.map((key, value) {
      if (_redactedKeys.contains(key.toLowerCase())) {
        return MapEntry(key, '***');
      }
      if (value is String &&
          const {'path', 'url', 'uri'}.contains(key.toLowerCase())) {
        return MapEntry(key, safePath(value));
      }
      if (value is Map<String, Object?>) return MapEntry(key, redact(value));
      if (value is List) {
        return MapEntry(
          key,
          value
              .map((item) => item is Map<String, Object?> ? redact(item) : item)
              .toList(),
        );
      }
      return MapEntry(key, value);
    });
  }
}
