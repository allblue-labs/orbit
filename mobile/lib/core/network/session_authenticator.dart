/// Renovação de sessão com rotação segura.
///
/// Requisições concorrentes com o mesmo token aguardam a mesma `Future`,
/// em vez de cada uma chamar `/identity/refresh`.
///
/// A janela de rotação pertence ao servidor, coordenada pelo banco entre
/// réplicas. Uma resposta concluída não fica em cache no app: a próxima
/// renovação precisa reconferir revogação, validade e permissões.
library;

import 'dart:async';

import '../observability/orbit_logger.dart';
import '../errors/orbit_exception.dart';
import '../storage/token_storage.dart';

/// Executa a chamada de refresh no backend. Injetado para não acoplar o
/// autenticador ao Dio (e para poder ser testado sem rede).
typedef RefreshCall = Future<TokenPair> Function(String refreshToken);

class SessionAuthenticator {
  SessionAuthenticator({
    required TokenStorage storage,
    required RefreshCall refreshCall,
    required OrbitLogger logger,
  }) : _storage = storage,
       _refreshCall = refreshCall,
       _logger = logger;

  final TokenStorage _storage;
  final RefreshCall _refreshCall;
  final OrbitLogger _logger;

  Future<TokenPair?>? _inFlight;
  String? _inFlightToken;
  int _generation = 0;
  Future<void> _tokenWrites = Future.value();

  int get generation => _generation;
  int? _expiredGeneration;
  bool get isCurrentExpiration => _expiredGeneration == _generation;

  static const changed = OrbitException(
    kind: OrbitErrorKind.unauthorized,
    publicMessage: 'A sessão foi alterada. Entre novamente.',
    code: 'SESSION_CHANGED',
  );

  Future<T> _serialize<T>(Future<T> Function() action) {
    final result = _tokenWrites.then((_) => action());
    _tokenWrites = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace __) {},
    );
    return result;
  }

  Future<void> storeTokens(TokenPair pair, {required int generation}) =>
      _serialize(() async {
        if (generation != _generation) throw changed;
        await _storage.write(pair);
      });

  /// Invalidates work immediately; token mutations are ordered with refresh/login.
  Future<TokenPair?> clearSession() {
    reset();
    final generation = _generation;
    return _serialize(() async {
      if (generation != _generation) return null;
      final previous = await _storage.read();
      await _storage.clear();
      return previous;
    });
  }

  /// Sessão encerrada — a interface reage voltando para o login.
  final _expired = StreamController<void>.broadcast();
  Stream<void> get onExpired => _expired.stream;

  /// Renova o par de tokens; `null` quando a sessão não pode ser recuperada.
  Future<TokenPair?> refresh(String usedRefreshToken) {
    final pending = _inFlight;
    if (pending != null && _inFlightToken == usedRefreshToken) return pending;

    final future = _performRefresh(usedRefreshToken);
    _inFlight = future;
    _inFlightToken = usedRefreshToken;
    return future;
  }

  Future<TokenPair?> _performRefresh(String usedRefreshToken) async {
    final generation = _generation;
    try {
      final pair = await _refreshCall(usedRefreshToken);
      if (generation != _generation) return null;
      await storeTokens(pair, generation: generation);
      if (generation != _generation) return null;
      _logger.info('sessão renovada');
      return pair;
    } on Object catch (error) {
      if (generation != _generation) return null;
      // Falha de renovação encerra a sessão: o refresh token não vale mais.
      _logger.warning('renovação de sessão falhou', data: {'motivo': '$error'});
      final clearing = clearSession();
      final endedGeneration = _generation;
      await clearing;
      if (endedGeneration == _generation && !_expired.isClosed) {
        _expiredGeneration = endedGeneration;
        _expired.add(null);
      }
      return null;
    } finally {
      if (generation == _generation && _inFlightToken == usedRefreshToken) {
        _inFlight = null;
        _inFlightToken = null;
      }
    }
  }

  /// Descarta o estado ao encerrar a sessão manualmente.
  void reset() {
    _generation++;
    _expiredGeneration = null;
    _inFlight = null;
    _inFlightToken = null;
  }

  Future<void> dispose() async => _expired.close();
}
