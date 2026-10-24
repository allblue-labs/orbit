/// Controlador de sessão.
///
/// Um único ponto decide se há sessão, quem é o usuário e qual o escopo ativo.
/// A navegação observa este estado; as telas nunca autenticam por conta
/// própria.
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/session_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/network/session_authenticator.dart';
import '../data/auth_repository.dart';
import '../domain/session.dart';

class AuthController extends StateNotifier<AuthState> {
  AuthController({
    required AuthRepository repository,
    required SessionAuthenticator authenticator,
  }) : _repository = repository,
       _authenticator = authenticator,
       _parent = null,
       super(const AuthRestoring()) {
    // O autenticador avisa quando a renovação falhou de vez.
    _expiredSubscription = authenticator.onExpired.listen((_) {
      if (!authenticator.isCurrentExpiration) return;
      _operation++;
      state = const AuthUnauthenticated(
        reason: 'Sua sessão expirou. Entre novamente.',
      );
    });
  }

  /// A fresh feature container observes auth without owning the root session.
  AuthController.mirror(AuthController parent)
    : _repository = parent._repository,
      _authenticator = parent._authenticator,
      _parent = parent,
      super(parent.state) {
    _mirrorKey = _sessionKey(parent.state);
    _removeMirrorListener = parent.addListener((value) {
      if (mounted) state = value;
    }, fireImmediately: false);
  }

  final AuthRepository _repository;
  final SessionAuthenticator _authenticator;
  final AuthController? _parent;
  StreamSubscription<void>? _expiredSubscription;
  void Function()? _removeMirrorListener;
  int _operation = 0;
  Object? _mirrorKey;

  static Object? _sessionKey(AuthState value) => value is AuthAuthenticated
      ? (
          value.session.user.id,
          value.session.organizationId,
          value.session.businessUnitId,
          value.session.claims.sessionId,
        )
      : value.runtimeType;

  bool get _canDelegate =>
      mounted && (_parent == null || _mirrorKey == _sessionKey(_parent.state));

  bool _current(int operation) => mounted && operation == _operation;

  /// Restaura a sessão guardada ao abrir o app.
  ///
  /// Não valida o token na rede: se estiver vencido, a primeira requisição
  /// dispara a renovação pelo interceptor. Isso deixa a abertura rápida mesmo
  /// com rede ruim.
  Future<void> restore() async {
    if (_parent case final parent?) return parent.restore();
    final operation = ++_operation;
    try {
      // A leitura do armazenamento seguro entra no `try`: ela também pode
      // falhar, e falhar aqui deixava a splash girando pelo mesmo motivo.
      final claims = await _repository.readClaims();
      if (!_current(operation)) return;
      if (claims == null) {
        state = const AuthUnauthenticated();
        return;
      }
      final session = await _composeSession(claims);
      if (_current(operation)) state = AuthAuthenticated(session);
    } on OrbitException catch (error) {
      if (!_current(operation)) return;
      if (error.isUnauthorized) {
        state = const AuthUnauthenticated(
          reason: 'Sua sessão expirou. Entre novamente.',
        );
        return;
      }
      // Qualquer outra falha também precisa sair da restauração.
      //
      // O erro era relançado, e ninguém o pegava: `restore()` é chamada sem
      // `await` na abertura do app. Sem servidor alcançável, o estado ficava em
      // `AuthRestoring` para sempre e a pessoa via a splash girando sem
      // explicação nenhuma.
      //
      // A sessão guardada **não** é apagada: o problema é chegar ao servidor,
      // não o token. Entrar de novo, ou uma rede que volte, resolve.
      state = AuthUnauthenticated(reason: error.publicMessage);
    } catch (_) {
      if (!_current(operation)) return;
      // Nada justifica ficar preso na abertura: o que não se sabe explicar
      // ainda assim leva ao login, onde há o que fazer.
      state = const AuthUnauthenticated(
        reason: 'Não foi possível retomar a sessão. Entre novamente.',
      );
    }
  }

  Future<void> login({
    required String email,
    required String password,
    String? mfaCode,
  }) async {
    if (_parent case final parent?) {
      return parent.login(email: email, password: password, mfaCode: mfaCode);
    }
    final operation = ++_operation;
    state = const AuthUnauthenticated();
    final tokens = await _repository.login(
      email: email,
      password: password,
      mfaCode: mfaCode,
    );
    if (!_current(operation)) return;
    final claims = AuthRepository.decodeClaims(tokens.accessToken);
    if (claims == null) {
      throw const OrbitException(
        kind: OrbitErrorKind.parse,
        publicMessage: 'Não foi possível concluir a entrada. Tente novamente.',
        code: 'PARSE',
      );
    }
    final session = await _composeSession(claims);
    if (_current(operation)) state = AuthAuthenticated(session);
  }

  Future<void> logout() async {
    if (!_canDelegate) return;
    if (_parent case final parent?) return parent.logout();
    _operation++;
    _authenticator.reset();
    state = const AuthUnauthenticated();
    await _repository.logout();
  }

  /// Aplica os dados que a pessoa acabou de editar sobre si.
  ///
  /// Sem recompor a sessão inteira: organização, plano e claims não mudaram
  /// porque alguém corrigiu o próprio telefone, e recarregá-los custaria
  /// três requisições para atualizar um campo que já veio na resposta do
  /// `PATCH`.
  void applyUser(OrbitUser user) {
    if (!_canDelegate) return;
    if (_parent case final parent?) return parent.applyUser(user);
    final current = state;
    if (current is! AuthAuthenticated || current.session.user.id != user.id) {
      return;
    }
    state = AuthAuthenticated(current.session.copyWith(user: user));
  }

  /// Recarrega o perfil do servidor, mantendo o resto da sessão.
  ///
  /// Existe para o que **não** volta na resposta de um comando: o endereço
  /// da foto é assinado e temporário, e só o `GET /identity/me` o traz.
  Future<void> refreshProfile() async {
    if (!_canDelegate) return;
    if (_parent case final parent?) return parent.refreshProfile();
    final operation = _operation;
    final current = state;
    if (current is! AuthAuthenticated) return;
    final user = await _repository.loadProfile();
    if (!_current(operation) || state is! AuthAuthenticated) return;
    if (user.id != current.session.user.id) throw SessionAuthenticator.changed;
    final latest = state as AuthAuthenticated;
    state = AuthAuthenticated(latest.session.copyWith(user: user));
  }

  /// Troca a própria senha e libera o aplicativo.
  ///
  /// Recarrega o perfil em seguida porque é ele que carrega
  /// `mustChangePassword`: sem isso o roteador continuaria prendendo a pessoa
  /// na tela de troca depois de ela já ter trocado.
  ///
  /// O backend revoga as **outras** sessões, não esta: quem acabou de provar a
  /// senha atual segue trabalhando sem precisar entrar de novo.
  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    if (_parent case final parent?) {
      if (!_canDelegate) return;
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
    if (!_current(operation)) return;
    await refreshProfile();
  }

  /// Pede o link de redefinição de senha — a tela de login usa.
  Future<void> requestPasswordReset(String email) =>
      _parent?.requestPasswordReset(email) ??
      _repository.requestPasswordReset(email);

  /// Troca a unidade ativa.
  ///
  /// O backend aceita `businessUnitId` como filtro em várias consultas, então a
  /// troca muda o que o app pede — sem alterar o escopo do token, que é do
  /// servidor.
  void selectBusinessUnit(String businessUnitId) {
    if (!_canDelegate) return;
    if (_parent case final parent?) {
      return parent.selectBusinessUnit(businessUnitId);
    }
    final current = state;
    if (current is! AuthAuthenticated) return;
    state = AuthAuthenticated(
      current.session.copyWith(activeBusinessUnitId: businessUnitId),
    );
  }

  Future<OrbitSession> _composeSession(AccessTokenClaims claims) async {
    // Perfil e acesso atual são obrigatórios. As permissões do token podem
    // anteceder mudanças no papel; nunca substituem a consulta ao servidor.
    // Organização e plano só existem para tenant.
    final results = await Future.wait([
      _repository.loadProfile(),
      if (claims.organizationId != null)
        _repository.loadOrganization()
      else
        Future<Organization?>.value(),
      if (claims.organizationId != null)
        _repository.loadEntitlements()
      else
        Future<Entitlements?>.value(),
      if (claims.organizationId != null)
        _repository.loadProductAccess()
      else
        Future<ProductAccess?>.value(),
      _repository.loadAccess(),
    ]);

    final user = results[0]! as OrbitUser;
    final organization = results[1] as Organization?;
    if (user.id != claims.userId ||
        (organization != null && organization.id != claims.organizationId)) {
      throw SessionAuthenticator.changed;
    }

    return OrbitSession(
      user: user,
      claims: claims,
      access: results[4]! as SessionAccess,
      organization: results[1] as Organization?,
      entitlements: results[2] as Entitlements?,
      productAccess: results[3] as ProductAccess?,
    );
  }

  @override
  void dispose() {
    _removeMirrorListener?.call();
    _expiredSubscription?.cancel();
    super.dispose();
  }
}
