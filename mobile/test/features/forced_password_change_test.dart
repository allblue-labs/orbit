/// Senha temporária prende o aplicativo na troca.
///
/// O dono cadastra o técnico e entrega uma senha provisória. Enquanto ela
/// valer, nada do trabalho de campo pode acontecer em nome dessa pessoa — o
/// dono ainda conhece a credencial.
///
/// O teste cobre a junção, que é onde o relato aconteceu: não basta o servidor
/// mandar `mustChangePassword`, nem o roteador saber lê-lo. É preciso que a
/// sessão composta pelo `AuthController` carregue o campo **e** que o
/// `redirect` do roteador real o respeite antes de qualquer outra decisão.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/network/session_authenticator.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/features/authentication/application/auth_controller.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';

import '../support/fakes.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

/// O técnico recém-cadastrado: credencial provisória, escolhida por outro.
const _comSenhaTemporaria = OrbitUser(
  id: 'user-tec',
  email: 'tecnico@exemplo.com',
  displayName: 'Técnico de Campo',
  mustChangePassword: true,
);

final _organizacao = Organization.fromJson(const {
  'id': 'org-1',
  'displayName': 'Organização',
  'subscriptionStatus': 'ACTIVE',
  'primarySegment': 'HVAC_R',
  'plan': {
    'key': 'ESSENTIAL',
    'name': 'Essencial',
    'capabilities': ['operations.read'],
  },
  'businessUnits': [
    {'id': 'unit-1', 'legalName': 'Matriz LTDA', 'tradeName': 'Matriz'},
  ],
});

final _direitos = Entitlements.fromJson(const {
  'planKey': 'ESSENTIAL',
  'subscriptionStatus': 'ACTIVE',
  'capabilities': ['operations.read'],
});

void main() {
  late _MockAuthRepository repositorio;

  setUp(() {
    repositorio = _MockAuthRepository();
    when(
      () => repositorio.loadProfile(),
    ).thenAnswer((_) async => _comSenhaTemporaria);
    when(
      () => repositorio.loadOrganization(),
    ).thenAnswer((_) async => _organizacao);
    when(
      () => repositorio.loadEntitlements(),
    ).thenAnswer((_) async => _direitos);
    when(
      () => repositorio.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
        mfaCode: any(named: 'mfaCode'),
      ),
    ).thenAnswer(
      (_) async => TokenPair(
        accessToken: fakeAccessToken(permissions: const ['operations.read']),
        refreshToken: 'refresh-1',
        expiresIn: 900,
      ),
    );
  });

  AuthController construir() => AuthController(
    repository: repositorio,
    authenticator: SessionAuthenticator(
      storage: InMemoryTokenStorage(),
      logger: const OrbitLogger(isProduction: true),
      refreshCall: (_) async => throw StateError('não renova neste teste'),
    ),
  );

  test('a sessão composta carrega a troca obrigatória', () async {
    final controlador = construir();
    await controlador.login(
      email: 'tecnico@exemplo.com',
      password: 'provisoria',
    );

    final estado = controlador.state;
    expect(estado, isA<AuthAuthenticated>());
    expect(
      (estado as AuthAuthenticated).session.user.mustChangePassword,
      isTrue,
      reason: '`_composeSession` precisa preservar o campo do perfil',
    );
  });

  testWidgets('o roteador real prende na troca, e não abre a home', (
    tester,
  ) async {
    final controlador = construir();
    await controlador.login(
      email: 'tecnico@exemplo.com',
      password: 'provisoria',
    );

    final container = ProviderContainer(
      overrides: [authControllerProvider.overrideWith((ref) => controlador)],
    );
    addTearDown(container.dispose);

    final router = container.read(routerProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      router.routerDelegate.currentConfiguration.uri.path,
      OrbitRoutes.changePassword,
      reason:
          'entrar com a senha que o dono escolheu não pode abrir o aplicativo',
    );
  });

  testWidgets('trocada a senha, o roteador libera a home', (tester) async {
    final controlador = construir();
    await controlador.login(
      email: 'tecnico@exemplo.com',
      password: 'provisoria',
    );

    /* O backend zera o campo; o app recarrega o perfil. */
    when(
      () => repositorio.changePassword(
        currentPassword: any(named: 'currentPassword'),
        newPassword: any(named: 'newPassword'),
      ),
    ).thenAnswer((_) async {});
    when(() => repositorio.loadProfile()).thenAnswer(
      (_) async => const OrbitUser(
        id: 'user-tec',
        email: 'tecnico@exemplo.com',
        displayName: 'Técnico de Campo',
      ),
    );

    final container = ProviderContainer(
      overrides: [authControllerProvider.overrideWith((ref) => controlador)],
    );
    addTearDown(container.dispose);

    final router = container.read(routerProvider);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(routerConfig: router),
      ),
    );
    await tester.pumpAndSettle();

    await controlador.changePassword(
      currentPassword: 'provisoria',
      newPassword: 'a-minha-agora',
    );
    await tester.pumpAndSettle();

    expect(
      router.routerDelegate.currentConfiguration.uri.path,
      isNot(OrbitRoutes.changePassword),
    );
  });
}
