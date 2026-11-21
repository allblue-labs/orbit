/// Sessão do cliente.
///
/// Independente da sessão da equipe: outro armazenamento seguro
/// (`orbit.portal.*`), outro cliente HTTP, outra renovação. As duas nunca
/// coexistem na tela — o roteador olha esta primeiro —, mas nunca se
/// misturam no aparelho: sair de uma não toca na outra.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/orbit_api_client.dart';
import '../../../core/network/session_authenticator.dart';
import '../../../core/storage/token_storage.dart';
import '../data/portal_contracts.dart';
import '../data/portal_repository.dart';

sealed class PortalAuthState {
  const PortalAuthState();
}

/// Lendo a sessão guardada — a splash espera.
class PortalRestoring extends PortalAuthState {
  const PortalRestoring();
}

class PortalSignedOut extends PortalAuthState {
  const PortalSignedOut({this.reason});

  /// Por que caiu fora, quando não foi a própria pessoa que saiu.
  final String? reason;
}

class PortalSignedIn extends PortalAuthState {
  const PortalSignedIn(this.me);

  final PortalMe me;
}

class PortalSessionController extends StateNotifier<PortalAuthState> {
  PortalSessionController({
    required PortalRepository repository,
    required SessionAuthenticator authenticator,

    /// Começa restaurando: o app chama `restore()` ao abrir. Testes que
    /// montam o roteador sem cliente nenhum começam já em [PortalSignedOut].
    PortalAuthState initial = const PortalRestoring(),
  }) : _repository = repository,
       _parent = null,
       super(initial) {
    _expired = authenticator.onExpired.listen((_) {
      if (!authenticator.isCurrentExpiration) return;
      _operation++;
      state = const PortalSignedOut(
        reason: 'Sua sessão expirou. Entre novamente.',
      );
    });
  }

  /// O runtime de cada sessão observa a raiz sem ser dono dela.
  PortalSessionController.mirror(PortalSessionController parent)
    : _repository = parent._repository,
      _parent = parent,
      super(parent.state) {
    _removeListener = parent.addListener((value) {
      if (mounted) state = value;
    }, fireImmediately: false);
  }

  final PortalRepository _repository;
  final PortalSessionController? _parent;
  StreamSubscription<void>? _expired;
  void Function()? _removeListener;
  int _operation = 0;

  bool _current(int operation) => mounted && operation == _operation;

  /// Restaura a sessão guardada. Sem sessão de cliente, sai rápido — é o caso
  /// de todo aparelho da equipe.
  Future<void> restore() async {
    if (_parent case final parent?) return parent.restore();
    final operation = ++_operation;
    try {
      if (!await _repository.hasStoredSession()) {
        if (_current(operation)) state = const PortalSignedOut();
        return;
      }
      final me = await _repository.me();
      if (_current(operation)) state = PortalSignedIn(me);
    } on OrbitException catch (error) {
      if (!_current(operation)) return;
      if (error.isUnauthorized) {
        await _repository.authenticator.clearSession();
        if (_current(operation)) {
          state = const PortalSignedOut(
            reason: 'Sua sessão expirou. Entre novamente.',
          );
        }
        return;
      }
      /* Sem servidor, a sessão guardada fica: o problema é a rede. */
      state = PortalSignedOut(reason: error.publicMessage);
    } catch (_) {
      if (_current(operation)) {
        state = const PortalSignedOut(
          reason: 'Não foi possível retomar a sessão. Entre novamente.',
        );
      }
    }
  }

  Future<void> login({required String email, required String password}) async {
    if (_parent case final parent?) {
      return parent.login(email: email, password: password);
    }
    final operation = ++_operation;
    final session = await _repository.login(email: email, password: password);
    if (_current(operation)) state = PortalSignedIn(session.me);
  }

  Future<void> logout() async {
    if (_parent case final parent?) return parent.logout();
    _operation++;
    state = const PortalSignedOut();
    await _repository.logout();
  }

  /// Troca a senha e libera o app — o `me` relido diz que a troca foi feita.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    if (_parent case final parent?) {
      return parent.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
    }
    final operation = _operation;
    await _repository.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    final me = await _repository.me();
    if (_current(operation)) state = PortalSignedIn(me);
  }

  @override
  void dispose() {
    _removeListener?.call();
    _expired?.cancel();
    super.dispose();
  }
}

/// Armazenamento próprio: `orbit.portal.*`, nunca as chaves da equipe.
final portalTokenStorageProvider = Provider<TokenStorage>(
  (ref) =>
      SerializedTokenStorage(SecureTokenStorage(namespace: 'orbit.portal')),
);

final portalApiClientProvider = Provider<OrbitApiClient>(
  (ref) => OrbitApiClient.create(
    environment: ref.watch(environmentProvider),
    storage: ref.watch(portalTokenStorageProvider),
    logger: ref.watch(loggerProvider),
    refreshPath: '/portal/auth/refresh',
  ),
);

final portalRepositoryProvider = Provider<PortalRepository>(
  (ref) => PortalRepository(
    client: ref.watch(portalApiClientProvider),
    storage: ref.watch(portalTokenStorageProvider),
  ),
);

final portalSessionProvider =
    StateNotifierProvider<PortalSessionController, PortalAuthState>(
      (ref) => PortalSessionController(
        repository: ref.watch(portalRepositoryProvider),
        authenticator: ref.watch(portalApiClientProvider).authenticator,
      ),
    );

/// Quem está logado como cliente, ou `null`.
final portalMeProvider = Provider<PortalMe?>((ref) {
  final state = ref.watch(portalSessionProvider);
  return state is PortalSignedIn ? state.me : null;
});
