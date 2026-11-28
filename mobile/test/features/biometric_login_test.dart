/// Entrar com a biometria no app: assinatura, cofre e telas.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/session_authenticator.dart';
import 'package:orbit_operator/core/security/biometric_vault.dart';
import 'package:orbit_operator/core/security/device_biometrics.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/authentication/application/biometric_login.dart';
import 'package:orbit_operator/features/authentication/presentation/biometric_widgets.dart';
import 'package:orbit_operator/features/authentication/presentation/login_screen.dart';
import 'package:orbit_operator/features/customer_portal/application/portal_session.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_contracts.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_repository.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/fakes.dart';

const ({String password, String? mfaCode}) _credentials = (
  password: 'test-password',
  mfaCode: null,
);

class _MockPortalRepository extends Mock implements PortalRepository {}

class _FakeBiometrics implements DeviceBiometrics {
  bool available = true;
  bool approve = true;
  int prompts = 0;
  Future<DeviceKey> Function()? onCreateKey;
  final deleted = <String>[];

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<DeviceKey> createKey() async {
    final handler = onCreateKey;
    if (handler != null) return handler();
    return (keyId: 'native-key', publicKey: 'public-key');
  }

  @override
  Future<void> deleteKey(String keyId) async => deleted.add(keyId);

  @override
  Future<String?> sign(String keyId, String challenge, String reason) async {
    expect(keyId, 'native-key');
    expect(challenge, 'challenge');
    prompts++;
    return approve ? 'signature' : null;
  }
}

PortalMe _me() => PortalMe.fromJson({
  'actorType': 'CUSTOMER_PORTAL',
  'identity': {
    'id': 'identity-1',
    'displayName': 'Clínica Sol',
    'email': 'clinica.sol@clima-norte.com',
    'status': 'active',
  },
  'organization': {
    'id': 'org-1',
    'slug': 'clima-norte',
    'displayName': 'Clima Norte',
  },
  'customer': {'id': 'customer-1', 'displayName': 'Clínica Sol LTDA'},
  'sessionId': 'session-1',
  'mustChangePassword': false,
});

void main() {
  late _MockPortalRepository portal;
  late _FakeBiometrics device;
  late MemoryBiometricVault vault;
  late SharedPreferences prefs;

  setUpAll(() {
    registerFallbackValue((String _) async => null);
  });

  void stubEnrollment(String id) {
    when(
      () => portal.enrollDeviceCredential(
        deviceId: any(named: 'deviceId'),
        label: any(named: 'label'),
        publicKey: 'public-key',
        sign: any(named: 'sign'),
        credentials: _credentials,
      ),
    ).thenAnswer((call) async {
      final sign =
          call.namedArguments[#sign] as Future<String?> Function(String);
      final signature = await sign('challenge');
      return signature == 'signature' ? id : null;
    });
  }

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
    portal = _MockPortalRepository();
    device = _FakeBiometrics();
    vault = MemoryBiometricVault();
    when(
      () => portal.authenticator,
    ).thenReturn(InMemorySessionAuthenticator.create());
  });

  List<Override> overrides() => [
    sharedPreferencesProvider.overrideWithValue(prefs),
    deviceBiometricsProvider.overrideWithValue(device),
    biometricVaultProvider.overrideWithValue(vault),
    portalRepositoryProvider.overrideWithValue(portal),
    portalSessionProvider.overrideWith(
      (ref) => PortalSessionController(
        repository: portal,
        authenticator: portal.authenticator,
        initial: const PortalSignedOut(),
      ),
    ),
  ];

  group('serviço', () {
    late ProviderContainer container;
    setUp(() => container = ProviderContainer(overrides: overrides()));
    tearDown(() => container.dispose());

    test('ativar pede a biometria e guarda a credencial no cofre', () async {
      stubEnrollment('cred-1');

      final result = await container
          .read(biometricLoginProvider)
          .enable(BiometricAudience.customer, _credentials);

      expect(result, BiometricEnableResult.enabled);
      expect(device.prompts, 1);
      expect(
        (await vault.read(BiometricAudience.customer))?.keyId,
        'native-key',
      );
      expect(await vault.read(BiometricAudience.team), isNull);
    });

    test('cancelar a biometria remove a chave local recém-criada', () async {
      stubEnrollment('cred-1');
      device.approve = false;
      final result = await container
          .read(biometricLoginProvider)
          .enable(BiometricAudience.customer, _credentials);
      expect(result, BiometricEnableResult.cancelled);
      expect(device.deleted, ['native-key']);
      expect(await vault.read(BiometricAudience.customer), isNull);
    });

    test(
      'trocar de sessão durante a criação da chave cancela o cadastro',
      () async {
        final started = Completer<void>();
        final pendingKey = Completer<DeviceKey>();
        device.onCreateKey = () {
          started.complete();
          return pendingKey.future;
        };
        final registration = expectLater(
          container
              .read(biometricLoginProvider)
              .enable(BiometricAudience.customer, _credentials),
          throwsA(same(SessionAuthenticator.changed)),
        );
        await started.future;
        await portal.authenticator.clearSession();
        pendingKey.complete((keyId: 'native-key', publicKey: 'public-key'));
        await registration;
        expect(device.prompts, 0);
        expect(device.deleted, ['native-key']);
        expect(await vault.read(BiometricAudience.customer), isNull);
      },
    );

    test('entrar assina o desafio e mantém a referência local', () async {
      await vault.write(
        BiometricAudience.customer,
        const BiometricCredential(credentialId: 'cred-1', keyId: 'native-key'),
      );
      when(
        () => portal.loginWithDeviceCredential(
          credentialId: 'cred-1',
          sign: any(named: 'sign'),
        ),
      ).thenAnswer((call) async {
        final sign =
            call.namedArguments[#sign] as Future<String?> Function(String);
        expect(await sign('challenge'), 'signature');
        return PortalSession(
          tokens: const TokenPair(
            accessToken: 'a',
            refreshToken: 'r',
            expiresIn: 60,
          ),
          me: _me(),
        );
      });

      final entrou = await container
          .read(biometricLoginProvider)
          .signIn(BiometricAudience.customer);

      expect(entrou, isTrue);
      expect(
        (await vault.read(BiometricAudience.customer))?.keyId,
        'native-key',
      );
      expect(container.read(portalSessionProvider), isA<PortalSignedIn>());
    });

    test(
      'recusa do servidor apaga o cofre e manda entrar com a senha',
      () async {
        await vault.write(
          BiometricAudience.customer,
          const BiometricCredential(
            credentialId: 'cred-1',
            keyId: 'native-key',
          ),
        );
        when(
          () => portal.loginWithDeviceCredential(
            credentialId: any(named: 'credentialId'),
            sign: any(named: 'sign'),
          ),
        ).thenThrow(
          const OrbitException(
            kind: OrbitErrorKind.unauthorized,
            publicMessage: 'x',
            code: 'BIOMETRIC_INVALID',
            status: 401,
          ),
        );

        await expectLater(
          container
              .read(biometricLoginProvider)
              .signIn(BiometricAudience.customer),
          throwsA(
            isA<OrbitException>().having(
              (error) => error.publicMessage,
              'mensagem',
              contains('Entre com a senha'),
            ),
          ),
        );
        expect(await vault.read(BiometricAudience.customer), isNull);
      },
    );

    test('o convite aparece uma vez por login, e "Agora não" vale', () async {
      final service = container.read(biometricLoginProvider);
      expect(await service.takeOffer(BiometricAudience.team), isFalse);

      await service.markPasswordLogin(BiometricAudience.team);
      expect(await service.takeOffer(BiometricAudience.customer), isFalse);
      await service.markPasswordLogin(BiometricAudience.team);
      expect(await service.takeOffer(BiometricAudience.team), isTrue);
      expect(await service.takeOffer(BiometricAudience.team), isFalse);

      await service.dismissOffer(BiometricAudience.team);
      await service.markPasswordLogin(BiometricAudience.team);
      expect(await service.takeOffer(BiometricAudience.team), isFalse);

      /* Sem biometria no aparelho, não há o que oferecer. */
      device.available = false;
      await service.markPasswordLogin(BiometricAudience.customer);
      expect(await service.takeOffer(BiometricAudience.customer), isFalse);
    });
  });

  group('telas', () {
    Widget app(Widget child) => ProviderScope(
      overrides: overrides(),
      child: MaterialApp(theme: OrbitTheme.light(), home: child),
    );

    testWidgets('o login mostra "Entrar com biometria" só com o cofre ativo', (
      tester,
    ) async {
      await prefs.setString(loginAudienceKey, LoginAudience.customer.name);
      await tester.pumpWidget(app(const LoginScreen()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('login.biometric')), findsNothing);

      await vault.write(
        BiometricAudience.customer,
        const BiometricCredential(credentialId: 'cred-1', keyId: 'native-key'),
      );
      /* Outra abertura do login: o cofre é relido. */
      await tester.pumpWidget(const SizedBox());
      await tester.pumpWidget(app(const LoginScreen()));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('login.biometric')), findsOneWidget);

      /* No modo equipe, o cofre do cliente não conta. */
      await tester.tap(find.text('Sou da equipe'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('login.biometric')), findsNothing);
    });

    testWidgets('depois do login com senha, o shell convida uma vez', (
      tester,
    ) async {
      stubEnrollment('cred-9');
      await prefs.setString('orbit.biometric.offer.pending', 'customer');

      await tester.pumpWidget(
        app(
          const BiometricOfferGate(
            audience: BiometricAudience.customer,
            settingsHint: 'Perfil → Conta',
            child: Scaffold(body: Text('início')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('biometric.offer')), findsOneWidget);
      expect(find.textContaining('Perfil → Conta'), findsOneWidget);

      await tester.tap(find.byKey(const Key('biometric.offer.accept')));
      await tester.pumpAndSettle();
      await _confirm(tester);
      expect(find.byKey(const Key('biometric.offer')), findsNothing);
      expect(
        (await vault.read(BiometricAudience.customer))?.credentialId,
        'cred-9',
      );
      expect(find.textContaining('Biometria ativada'), findsOneWidget);
    });

    testWidgets('"Agora não" fecha e não pergunta mais', (tester) async {
      await prefs.setString('orbit.biometric.offer.pending', 'team');
      await tester.pumpWidget(
        app(
          const BiometricOfferGate(
            audience: BiometricAudience.team,
            settingsHint: 'Perfil → Configurações',
            child: Scaffold(body: Text('início')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('biometric.offer.skip')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('biometric.offer')), findsNothing);
      expect(prefs.getBool('orbit.biometric.offer.dismissed.team'), isTrue);
      expect(device.prompts, 0);
    });

    testWidgets('a linha de configurações liga e desliga', (tester) async {
      stubEnrollment('cred-3');
      when(
        () =>
            portal.revokeDeviceCredential('cred-3', credentials: _credentials),
      ).thenAnswer((_) async {});
      await tester.pumpWidget(
        app(
          const Scaffold(
            body: BiometricSettingsRow(audience: BiometricAudience.customer),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      await _confirm(tester);
      expect(await vault.read(BiometricAudience.customer), isNotNull);
      expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      await _confirm(tester);
      expect(await vault.read(BiometricAudience.customer), isNull);
      verify(
        () =>
            portal.revokeDeviceCredential('cred-3', credentials: _credentials),
      ).called(1);
    });
  });
}

Future<void> _confirm(WidgetTester tester) async {
  await tester.enterText(
    find.byKey(const Key('biometric.confirm.password')),
    _credentials.password,
  );
  await tester.tap(find.byKey(const Key('biometric.confirm.submit')));
  await tester.pumpAndSettle();
}
