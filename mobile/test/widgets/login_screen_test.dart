/// Tela de autenticação.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/network/orbit_interceptors.dart';

import '../security/public_error_guard.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';
import 'package:orbit_operator/features/authentication/presentation/login_screen.dart';

import '../support/fakes.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

Widget wrap(Widget child, {required AuthRepository repository}) {
  return ProviderScope(
    overrides: [authRepositoryProvider.overrideWithValue(repository)],
    child: MaterialApp(theme: OrbitTheme.light(), home: child),
  );
}

void main() {
  late _MockAuthRepository repository;

  setUp(() {
    repository = _MockAuthRepository();
    when(() => repository.loadProfile()).thenAnswer(
      (_) async => const OrbitUser(
        id: 'user-1',
        email: 'tecnico@acme.com',
        displayName: 'Marina Duarte',
      ),
    );
    when(() => repository.loadOrganization()).thenAnswer((_) async => null);
    when(() => repository.loadEntitlements()).thenAnswer((_) async => null);
  });

  testWidgets('exibe a marca e os campos de acesso', (tester) async {
    await tester.pumpWidget(wrap(const LoginScreen(), repository: repository));

    expect(find.text('Entrar'), findsWidgets);
    expect(find.byKey(const Key('login.email')), findsOneWidget);
    expect(find.byKey(const Key('login.password')), findsOneWidget);
    // O símbolo da marca aparece na autenticação.
    expect(find.byType(Image), findsOneWidget);
  });

  testWidgets('valida e-mail e senha antes de chamar o backend', (
    tester,
  ) async {
    await tester.pumpWidget(wrap(const LoginScreen(), repository: repository));

    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pump();

    expect(find.text('Informe um e-mail válido'), findsOneWidget);
    expect(find.text('A senha tem no mínimo 8 caracteres'), findsOneWidget);
    verifyNever(
      () => repository.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
        mfaCode: any(named: 'mfaCode'),
      ),
    );
  });

  testWidgets('o servidor fora do ar não vira endereço na tela', (
    tester,
  ) async {
    /// O cenário do incidente, no caminho que o técnico percorre: abre o
    /// aplicativo, digita e toca em Entrar com o backend inalcançável.
    ///
    /// A falha vem do mapeamento real de transporte — não de uma mensagem
    /// escrita à mão no teste —, então é a mesma que o aparelho produziria.
    final falha = ErrorMappingInterceptor(destination: '10.0.2.2:6001').map(
      DioException(
        requestOptions: RequestOptions(
          path: '/identity/login',
          baseUrl: 'http://10.0.2.2:6001/api/v1',
        ),
        type: DioExceptionType.connectionTimeout,
        message:
            'The request connectionTimeout was exceeded, '
            'uri: http://10.0.2.2:6001/api/v1/identity/login',
      ),
    );

    when(
      () => repository.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
        mfaCode: any(named: 'mfaCode'),
      ),
    ).thenThrow(falha);

    await tester.pumpWidget(wrap(const LoginScreen(), repository: repository));
    await tester.enterText(
      find.byKey(const Key('login.email')),
      'tecnico@acme.com',
    );
    await tester.enterText(
      find.byKey(const Key('login.password')),
      'senha-longa',
    );
    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pumpAndSettle();

    /// Nada do que a biblioteca disse chega à tela.
    final textos = tester
        .widgetList<Text>(find.byType(Text))
        .map((widget) => widget.data ?? '')
        .where((texto) => texto.isNotEmpty);
    expectSafePublicErrorAll(textos, onde: 'login com servidor fora do ar');

    /// E a pessoa recebe uma frase que diz o que aconteceu.
    expect(
      find.textContaining('demorando mais que o esperado'),
      findsOneWidget,
    );
  });

  testWidgets('mostra a mensagem pública devolvida pelo backend', (
    tester,
  ) async {
    when(
      () => repository.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
        mfaCode: any(named: 'mfaCode'),
      ),
    ).thenThrow(
      const OrbitException(
        kind: OrbitErrorKind.http,
        status: 401,
        publicMessage: 'Sua sessão não é válida ou expirou.',
        code: 'UNAUTHORIZED',
      ),
    );

    await tester.pumpWidget(wrap(const LoginScreen(), repository: repository));
    await tester.enterText(
      find.byKey(const Key('login.email')),
      'tecnico@acme.com',
    );
    await tester.enterText(
      find.byKey(const Key('login.password')),
      'senha-longa',
    );
    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pumpAndSettle();

    expect(find.text('Sua sessão não é válida ou expirou.'), findsOneWidget);
  });

  testWidgets('revela o campo de MFA quando o backend exige', (tester) async {
    when(
      () => repository.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
        mfaCode: any(named: 'mfaCode'),
      ),
    ).thenThrow(
      const OrbitException(
        kind: OrbitErrorKind.http,
        status: 401,
        publicMessage: 'Informe o código do seu autenticador.',
        code: 'MFA_REQUIRED',
      ),
    );

    await tester.pumpWidget(wrap(const LoginScreen(), repository: repository));
    await tester.enterText(
      find.byKey(const Key('login.email')),
      'tecnico@acme.com',
    );
    await tester.enterText(
      find.byKey(const Key('login.password')),
      'senha-longa',
    );
    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('login.mfa')), findsOneWidget);
  });

  testWidgets('autentica com credenciais válidas', (tester) async {
    when(
      () => repository.login(
        email: any(named: 'email'),
        password: any(named: 'password'),
        mfaCode: any(named: 'mfaCode'),
      ),
    ).thenAnswer(
      (_) async => TokenPair(
        accessToken: fakeAccessToken(),
        refreshToken: 'refresh-1',
        expiresIn: 900,
      ),
    );

    await tester.pumpWidget(wrap(const LoginScreen(), repository: repository));
    await tester.enterText(
      find.byKey(const Key('login.email')),
      'tecnico@acme.com',
    );
    await tester.enterText(
      find.byKey(const Key('login.password')),
      'senha-longa',
    );
    await tester.tap(find.byKey(const Key('login.submit')));
    await tester.pumpAndSettle();

    verify(
      () => repository.login(
        email: 'tecnico@acme.com',
        password: 'senha-longa',
        mfaCode: null,
      ),
    ).called(1);
  });
}
