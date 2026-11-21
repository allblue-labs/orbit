/// Entrar com a biometria no app: o cofre, o segredo trocado a cada uso, a
/// recusa do servidor, o convite pós-login e o botão do login.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
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

class _MockPortalRepository extends Mock implements PortalRepository {}

class _FakeBiometrics implements DeviceBiometrics {
  bool available = true;
  bool approve = true;
  int prompts = 0;

  @override
  Future<bool> isAvailable() async => available;

  @override
  Future<bool> authenticate(String reason) async {
    prompts++;
    return approve;
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
      when(
        () => portal.enrollDeviceCredential(
          deviceId: any(named: 'deviceId'),
          label: any(named: 'label'),
        ),
      ).thenAnswer((_) async => (credentialId: 'cred-1', secret: 's1'));

      final result = await container
          .read(biometricLoginProvider)
          .enable(BiometricAudience.customer);

      expect(result, BiometricEnableResult.enabled);
      expect(device.prompts, 1);
      expect((await vault.read(BiometricAudience.customer))?.secret, 's1');
      expect(await vault.read(BiometricAudience.team), isNull);
    });

    test('cancelar a biometria não pede nada ao servidor', () async {
      device.approve = false;
      final result = await container
          .read(biometricLoginProvider)
          .enable(BiometricAudience.customer);
      expect(result, BiometricEnableResult.cancelled);
      verifyNever(
        () => portal.enrollDeviceCredential(
          deviceId: any(named: 'deviceId'),
          label: any(named: 'label'),
        ),
      );
    });

    test('entrar troca o segredo do cofre pelo que o servidor devolveu', () async {
      await vault.write(
        BiometricAudience.customer,
        const BiometricCredential(credentialId: 'cred-1', secret: 's1'),
      );
      when(
        () => portal.loginWithDeviceCredential(
          credentialId: 'cred-1',
          secret: 's1',
        ),
      ).thenAnswer(
        (_) async => (
          session: PortalSession(
            tokens: const TokenPair(
              accessToken: 'a',
              refreshToken: 'r',
              expiresIn: 60,
            ),
            me: _me(),
          ),
          nextSecret: 's2',
        ),
      );

      final entrou = await container
          .read(biometricLoginProvider)
          .signIn(BiometricAudience.customer);

      expect(entrou, isTrue);
      expect((await vault.read(BiometricAudience.customer))?.secret, 's2');
      expect(container.read(portalSessionProvider), isA<PortalSignedIn>());
    });

    test('recusa do servidor apaga o cofre e manda entrar com a senha', () async {
      await vault.write(
        BiometricAudience.customer,
        const BiometricCredential(credentialId: 'cred-1', secret: 's1'),
      );
      when(
        () => portal.loginWithDeviceCredential(
          credentialId: any(named: 'credentialId'),
          secret: any(named: 'secret'),
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
    });

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
        const BiometricCredential(credentialId: 'cred-1', secret: 's1'),
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
      when(
        () => portal.enrollDeviceCredential(
          deviceId: any(named: 'deviceId'),
          label: any(named: 'label'),
        ),
      ).thenAnswer((_) async => (credentialId: 'cred-9', secret: 's9'));
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
      expect(find.byKey(const Key('biometric.offer')), findsNothing);
      expect((await vault.read(BiometricAudience.customer))?.secret, 's9');
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
      when(
        () => portal.enrollDeviceCredential(
          deviceId: any(named: 'deviceId'),
          label: any(named: 'label'),
        ),
      ).thenAnswer((_) async => (credentialId: 'cred-3', secret: 's3'));
      when(() => portal.revokeDeviceCredential('cred-3')).thenAnswer(
        (_) async {},
      );
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
      expect(await vault.read(BiometricAudience.customer), isNotNull);
      expect(tester.widget<Switch>(find.byType(Switch)).value, isTrue);

      await tester.tap(find.byType(Switch));
      await tester.pumpAndSettle();
      expect(await vault.read(BiometricAudience.customer), isNull);
      verify(() => portal.revokeDeviceCredential('cred-3')).called(1);
    });
  });
}
