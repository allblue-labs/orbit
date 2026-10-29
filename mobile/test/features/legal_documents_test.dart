import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/authentication/application/auth_controller.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';
import 'package:orbit_operator/features/legal/data/legal_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const document = {
  'title': 'Documento público do Orbit',
  'version': '2026-10',
  'effectiveAt': '2026-10-26',
  'provider': {
    'name': 'Allblue Labs',
    'privacyEmail': 'contato@allblue-labs.com',
  },
  'sections': [
    {
      'title': 'Seus dados',
      'paragraphs': ['Conteúdo público para leitura.'],
    },
  ],
};

class LegalTestAuth extends AuthController {
  LegalTestAuth(OrbitApiClient client, AuthState initial)
    : super(
        repository: AuthRepository(
          client: client,
          storage: InMemoryTokenStorage(),
        ),
        authenticator: client.authenticator,
      ) {
    state = initial;
  }
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));
  test('documentos usam a API pública sem enviar o token da conta', () async {
    final requests = <RequestOptions>[];
    final client = OrbitApiClient.create(
      environment: OrbitEnvironment.fromDefines(),
      storage: InMemoryTokenStorage(
        const TokenPair(
          accessToken: 'private',
          refreshToken: 'private-refresh',
          expiresIn: 900,
        ),
      ),
      logger: const OrbitLogger(isProduction: true),
      dio: Dio()
        ..httpClientAdapter = ScriptedAdapter((request) async {
          requests.add(request);
          return jsonResponse(envelope(document));
        }),
    );
    for (final kind in LegalDocumentKind.values) {
      final result = await LegalRepository(client).read(kind);
      expect(result.sections.single.paragraphs, [
        'Conteúdo público para leitura.',
      ]);
      expect(requests.last.path, '/legal/documents/${kind.slug}');
      expect(
        requests.last.headers.keys.map((k) => k.toLowerCase()),
        isNot(contains('authorization')),
      );
    }
  });

  final authStates = <AuthState>[
    const AuthUnauthenticated(),
    const AuthRestoring(),
    AuthAuthenticated(
      OrbitSession(
        user: const OrbitUser(
          id: 'new-user',
          email: 'new@example.test',
          displayName: 'Novo',
          mustChangePassword: true,
        ),
        claims: AccessTokenClaims.fromJson({
          'sub': 'new-user',
          'sid': 'session',
          'permissions': ['*'],
        }),
      ),
    ),
  ];
  for (final state in authStates) {
    testWidgets(
      'leitura pública em ${state.runtimeType} preserva os bloqueios das outras rotas',
      (tester) async {
        final client = OrbitApiClient.create(
          environment: OrbitEnvironment.fromDefines(),
          storage: InMemoryTokenStorage(),
          logger: const OrbitLogger(isProduction: true),
          dio: Dio()
            ..httpClientAdapter = ScriptedAdapter(
              (_) async => jsonResponse(envelope(document)),
            ),
        );
        final auth = LegalTestAuth(client, state);
        final container = ProviderContainer(
          overrides: [
            authControllerProvider.overrideWith((_) => auth),
            legalRepositoryProvider.overrideWithValue(LegalRepository(client)),
          ],
        );
        addTearDown(container.dispose);
        final router = container.read(routerProvider);
        await tester.pumpWidget(
          UncontrolledProviderScope(
            container: container,
            child: MaterialApp.router(
              theme: OrbitTheme.light(),
              routerConfig: router,
            ),
          ),
        );
        for (final path in [OrbitRoutes.privacy, OrbitRoutes.terms]) {
          router.go(path);
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 400));
          await tester.pump(const Duration(milliseconds: 400));
          expect(router.routerDelegate.currentConfiguration.uri.path, path);
          expect(find.text('Seus dados'), findsOneWidget);
          expect(find.text('Conteúdo público para leitura.'), findsOneWidget);
          expect(tester.takeException(), isNull);
        }
        router.go(OrbitRoutes.operations);
        await tester.pump();
        await tester.pump(const Duration(milliseconds: 400));
        final expected = state is AuthRestoring
            ? OrbitRoutes.splash
            : state is AuthAuthenticated
            ? OrbitRoutes.changePassword
            : OrbitRoutes.login;
        expect(router.routerDelegate.currentConfiguration.uri.path, expected);
        expect(tester.takeException(), isNull);
      },
    );
  }
}
