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
       super(const AuthRestoring()) {
    // O autenticador avisa quando a renovação falhou de vez.
    _expiredSubscription = authenticator.onExpired.listen((_) {
      state = const AuthUnauthenticated(
        reason: 'Sua sessão expirou. Entre novamente.',
      );
    });
  }

  final AuthRepository _repository;
  late final StreamSubscription<void> _expiredSubscription;

  /// Restaura a sessão guardada ao abrir o app.
  ///
  /// Não valida o token na rede: se estiver vencido, a primeira requisição
  /// dispara a renovação pelo interceptor. Isso deixa a abertura rápida mesmo
  /// com rede ruim.
  Future<void> restore() async {
    try {
      // A leitura do armazenamento seguro entra no `try`: ela também pode
      // falhar, e falhar aqui deixava a splash girando pelo mesmo motivo.
      final claims = await _repository.readClaims();
      if (claims == null) {
        state = const AuthUnauthenticated();
        return;
      }
      state = AuthAuthenticated(await _composeSession(claims));
    } on OrbitException catch (error) {
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
    final tokens = await _repository.login(
      email: email,
      password: password,
      mfaCode: mfaCode,
    );
    final claims = AuthRepository.decodeClaims(tokens.accessToken);
    if (claims == null) {
      throw const OrbitException(
        kind: OrbitErrorKind.parse,
        publicMessage: 'Não foi possível concluir a entrada. Tente novamente.',
        code: 'PARSE',
      );
    }
    state = AuthAuthenticated(await _composeSession(claims));
  }

  Future<void> logout() async {
    await _repository.logout();
    state = const AuthUnauthenticated();
  }

  /// Aplica os dados que a pessoa acabou de editar sobre si.
  ///
  /// Sem recompor a sessão inteira: organização, plano e claims não mudaram
  /// porque alguém corrigiu o próprio telefone, e recarregá-los custaria
  /// três requisições para atualizar um campo que já veio na resposta do
  /// `PATCH`.
  void applyUser(OrbitUser user) {
    final current = state;
    if (current is! AuthAuthenticated) return;
    state = AuthAuthenticated(current.session.copyWith(user: user));
  }

  /// Recarrega o perfil do servidor, mantendo o resto da sessão.
  ///
  /// Existe para o que **não** volta na resposta de um comando: o endereço
  /// da foto é assinado e temporário, e só o `GET /identity/me` o traz.
  Future<void> refreshProfile() async {
    final current = state;
    if (current is! AuthAuthenticated) return;
    final user = await _repository.loadProfile();
    state = AuthAuthenticated(current.session.copyWith(user: user));
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
    await _repository.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );
    await refreshProfile();
  }

  /// Pede o link de redefinição de senha — a tela de login usa.
  Future<void> requestPasswordReset(String email) =>
      _repository.requestPasswordReset(email);

  /// Troca a unidade ativa.
  ///
  /// O backend aceita `businessUnitId` como filtro em várias consultas, então a
  /// troca muda o que o app pede — sem alterar o escopo do token, que é do
  /// servidor.
  void selectBusinessUnit(String businessUnitId) {
    final current = state;
    if (current is! AuthAuthenticated) return;
    state = AuthAuthenticated(
      current.session.copyWith(activeBusinessUnitId: businessUnitId),
    );
  }

  Future<OrbitSession> _composeSession(AccessTokenClaims claims) async {
    // Perfil é obrigatório; organização e plano só existem para tenant.
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
    ]);

    return OrbitSession(
      user: results[0]! as OrbitUser,
      claims: claims,
      organization: results[1] as Organization?,
      entitlements: results[2] as Entitlements?,
      productAccess: results[3] as ProductAccess?,
    );
  }

  @override
  void dispose() {
    _expiredSubscription.cancel();
    super.dispose();
  }
}
