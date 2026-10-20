/// Sessão: login, restauração, logout e derivação de perfil.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/session_authenticator.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/features/authentication/application/auth_controller.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';

import '../support/fakes.dart';

class _MockAuthRepository extends Mock implements AuthRepository {}

const _user = OrbitUser(
  id: 'user-1',
  email: 'tecnico@acme.com',
  displayName: 'Marina Duarte',
);

final _organization = Organization.fromJson(const {
  'id': 'org-1',
  'displayName': 'Acme Industries',
  'subscriptionStatus': 'ACTIVE',
  'primarySegment': 'HVAC_R',
  'plan': {
    'key': 'STARTER',
    'name': 'Starter',
    'capabilities': ['operations.read', 'scheduling.read'],
  },
  'businessUnits': [
    {'id': 'unit-1', 'legalName': 'Acme LTDA', 'tradeName': 'Acme'},
    {'id': 'unit-2', 'legalName': 'Filial Sul', 'tradeName': 'Sul'},
  ],
});

final _entitlements = Entitlements.fromJson(const {
  'planKey': 'STARTER',
  'subscriptionStatus': 'ACTIVE',
  'capabilities': ['operations.read', 'scheduling.read'],
});

final _productAccess = ProductAccess.fromJson(const {
  'capabilities': ['ORBIT_INTELLIGENCE', 'AI_ASSISTANTS'],
  'featureAvailability': {
    'ORBIT_INTELLIGENCE': true,
    'AI_ASSISTANTS': true,
    'SCHEDULING_INTELLIGENCE': false,
  },
});

AuthController buildController(
  AuthRepository repository, {
  SessionAuthenticator? authenticator,
}) {
  return AuthController(
    repository: repository,
    authenticator:
        authenticator ??
        SessionAuthenticator(
          storage: InMemoryTokenStorage(),
          logger: const OrbitLogger(isProduction: true),
          refreshCall: (_) async =>
              throw StateError('não deve renovar neste teste'),
        ),
  );
}

void main() {
  late _MockAuthRepository repository;

  setUp(() {
    repository = _MockAuthRepository();
    when(() => repository.loadProfile()).thenAnswer((_) async => _user);
    when(
      () => repository.loadOrganization(),
    ).thenAnswer((_) async => _organization);
    when(
      () => repository.loadEntitlements(),
    ).thenAnswer((_) async => _entitlements);
    when(
      () => repository.loadProductAccess(),
    ).thenAnswer((_) async => _productAccess);
  });

  test('sem token guardado, o app abre desautenticado', () async {
    when(() => repository.readClaims()).thenAnswer((_) async => null);

    final controller = buildController(repository);
    await controller.restore();

    expect(controller.state, isA<AuthUnauthenticated>());
  });

  test('restaura a sessão e compõe organização, plano e unidades', () async {
    when(
      () => repository.readClaims(),
    ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));

    final controller = buildController(repository);
    await controller.restore();

    final state = controller.state;
    expect(state, isA<AuthAuthenticated>());
    final session = (state as AuthAuthenticated).session;
    expect(session.user.displayName, 'Marina Duarte');
    expect(session.organization?.displayName, 'Acme Industries');
    expect(session.capabilities, contains('scheduling.read'));
    expect(session.hasActiveSubscription, isTrue);
  });

  test('login autentica e deriva a sessão do token', () async {
    when(
      () => repository.login(
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

    final controller = buildController(repository);
    await controller.login(email: 'tecnico@acme.com', password: 'senha-longa');

    expect(controller.state, isA<AuthAuthenticated>());
  });

  test('applyUser troca o usuário sem recompor o resto da sessão', () async {
    /// Editar o próprio telefone não pode custar três requisições — e, mais
    /// importante, não pode derrubar organização e plano da sessão. Sem
    /// aplicar nada, a pessoa salva, fecha a folha e continua vendo o nome
    /// antigo no topo da tela: conclui que não salvou, e salva de novo.
    when(
      () => repository.readClaims(),
    ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));
    when(() => repository.loadProfile()).thenAnswer((_) async => _user);
    when(
      () => repository.loadOrganization(),
    ).thenAnswer((_) async => _organization);
    when(
      () => repository.loadEntitlements(),
    ).thenAnswer((_) async => _entitlements);

    final controller = buildController(repository);
    await controller.restore();
    final antes = (controller.state as AuthAuthenticated).session;

    /// Zera o que a restauração registrou: o que interessa é o que
    /// `applyUser` chama, e a restauração legitimamente chamou tudo.
    clearInteractions(repository);

    controller.applyUser(
      const OrbitUser(
        id: 'user-1',
        email: 'tecnico@acme.com',
        displayName: 'Marina D. Duarte',
        phone: '+55 81 99999-0000',
      ),
    );

    final depois = (controller.state as AuthAuthenticated).session;
    expect(depois.user.displayName, 'Marina D. Duarte');
    expect(depois.user.phone, '+55 81 99999-0000');

    /// O resto da sessão é o mesmo objeto: nada foi recarregado.
    expect(depois.organization, same(antes.organization));
    expect(depois.entitlements, same(antes.entitlements));
    expect(depois.claims, same(antes.claims));
    verifyNever(() => repository.loadOrganization());
  });

  test('logout limpa a sessão', () async {
    when(
      () => repository.readClaims(),
    ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));
    when(() => repository.logout()).thenAnswer((_) async {});

    final controller = buildController(repository);
    await controller.restore();
    await controller.logout();

    expect(controller.state, isA<AuthUnauthenticated>());
    verify(() => repository.logout()).called(1);
  });

  test('Platform Administrator não carrega organização', () async {
    when(() => repository.readClaims()).thenAnswer(
      (_) async => AuthRepository.decodeClaims(
        fakeAccessToken(
          organizationId: null,
          businessUnitId: null,
          roles: const ['PLATFORM_ADMIN'],
          permissions: const ['*', 'platform.admin'],
        ),
      ),
    );

    final controller = buildController(repository);
    await controller.restore();

    final session = (controller.state as AuthAuthenticated).session;
    expect(session.isPlatformAdmin, isTrue);
    expect(session.organization, isNull);
    verifyNever(() => repository.loadOrganization());
  });

  test('a sessão expirada pelo autenticador desautentica o app', () async {
    when(
      () => repository.readClaims(),
    ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));

    final storage = InMemoryTokenStorage(
      const TokenPair(
        accessToken: 'a',
        refreshToken: 'refresh-1',
        expiresIn: 900,
      ),
    );
    final authenticator = SessionAuthenticator(
      storage: storage,
      logger: const OrbitLogger(isProduction: true),
      refreshCall: (_) async => throw Exception('refresh inválido'),
    );

    final controller = buildController(
      repository,
      authenticator: authenticator,
    );
    await controller.restore();
    expect(controller.state, isA<AuthAuthenticated>());

    // O interceptor tentaria renovar e falharia.
    await authenticator.refresh('refresh-1');
    await Future<void>.delayed(Duration.zero);

    expect(controller.state, isA<AuthUnauthenticated>());
  });

  group('perfil derivado das permissões', () {
    test('Owner usa authority estrutural mesmo sem wildcard', () async {
      when(() => repository.readClaims()).thenAnswer(
        (_) async => AuthRepository.decodeClaims(
          fakeAccessToken(permissions: const [], isOrganizationOwner: true),
        ),
      );

      final controller = buildController(repository);
      await controller.restore();

      final session = (controller.state as AuthAuthenticated).session;
      expect(session.hasPermission('future.permission'), isTrue);
      expect(session.hasRole('ADMINISTRATOR'), isTrue);
      expect(session.hasRole(platformAdminRole), isFalse);
    });

    test('Intelligence exige entitlement e feature publicada', () async {
      when(
        () => repository.readClaims(),
      ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));

      final controller = buildController(repository);
      await controller.restore();

      final session = (controller.state as AuthAuthenticated).session;
      expect(session.canUseProductFeature('ORBIT_INTELLIGENCE'), isTrue);
      expect(
        session.canUseProductFeature(
          'ORBIT_INTELLIGENCE',
          'SCHEDULING_INTELLIGENCE',
        ),
        isFalse,
      );
    });

    test('quem gerencia operações usa a experiência de gestão', () async {
      when(() => repository.readClaims()).thenAnswer(
        (_) async => AuthRepository.decodeClaims(
          fakeAccessToken(
            permissions: const ['operations.read', 'operations.manage'],
          ),
        ),
      );

      final controller = buildController(repository);
      await controller.restore();

      final session = (controller.state as AuthAuthenticated).session;
      expect(session.profile, OrbitProfile.owner);
    });

    test('quem só executa usa a experiência de operação', () async {
      when(() => repository.readClaims()).thenAnswer(
        (_) async => AuthRepository.decodeClaims(
          fakeAccessToken(
            roles: const ['TECHNICIAN'],
            permissions: const ['operations.read', 'checklists.execute'],
          ),
        ),
      );

      final controller = buildController(repository);
      await controller.restore();

      final session = (controller.state as AuthAuthenticated).session;
      expect(session.profile, OrbitProfile.operator);
      expect(session.hasPermission('operations.manage'), isFalse);
    });
  });

  test('troca de unidade ativa altera o escopo das consultas', () async {
    when(
      () => repository.readClaims(),
    ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));

    final controller = buildController(repository);
    await controller.restore();
    expect(
      (controller.state as AuthAuthenticated).session.businessUnitId,
      'unit-1',
    );

    controller.selectBusinessUnit('unit-2');

    final session = (controller.state as AuthAuthenticated).session;
    expect(session.businessUnitId, 'unit-2');
    expect(session.businessUnit?.name, 'Sul');
  });

  test('servidor inalcançável leva ao login, não à splash eterna', () async {
    when(
      () => repository.readClaims(),
    ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));
    when(() => repository.loadProfile()).thenThrow(
      const OrbitException(
        kind: OrbitErrorKind.network,
        publicMessage: 'sem rede',
        code: 'NETWORK',
      ),
    );

    final controller = buildController(repository);
    await controller.restore();

    /**
     * O erro era relançado e ninguém o pegava — `restore()` é chamada sem
     * `await` na abertura —, então o estado ficava em `AuthRestoring` e o app
     * girava na splash para sempre.
     */
    final state = controller.state;
    expect(state, isA<AuthUnauthenticated>());

    /// O motivo é a mensagem **pública** da falha, atravessada sem reescrita.
    ///
    /// Antes o controlador montava a própria frase quando a falha era de rede,
    /// e a do transporte era descartada. Hoje há uma frase só, e ela vem de
    /// onde a falha foi classificada.
    expect((state as AuthUnauthenticated).reason, 'sem rede');
  });

  test('falha inesperada na restauração também sai da splash', () async {
    when(() => repository.readClaims()).thenThrow(StateError('armazenamento'));

    final controller = buildController(repository);
    await controller.restore();

    expect(controller.state, isA<AuthUnauthenticated>());
  });

  group('troca obrigatória de senha', _trocaDeSenha);
}

/// Troca obrigatória de senha.
///
/// O que se prova: que o controlador **relê o perfil** depois de trocar. Sem
/// isso `mustChangePassword` continuaria verdadeiro na sessão em memória, e o
/// roteador devolveria a pessoa à mesma tela logo após ela ter obedecido —
/// um laço do qual só sairia saindo do aplicativo.
void _trocaDeSenha() {
  late _MockAuthRepository repository;

  setUp(() {
    repository = _MockAuthRepository();
    when(
      () => repository.loadOrganization(),
    ).thenAnswer((_) async => _organization);
    when(
      () => repository.loadEntitlements(),
    ).thenAnswer((_) async => _entitlements);
    when(
      () => repository.loadProductAccess(),
    ).thenAnswer((_) async => _productAccess);
  });

  test('a exigência some da sessão depois da troca', () async {
    /// Primeiro perfil: senha temporária. Depois da troca: já não.
    var trocou = false;
    when(() => repository.loadProfile()).thenAnswer(
      (_) async => OrbitUser(
        id: 'user-1',
        email: 'tecnico@acme.com',
        displayName: 'Marina Duarte',
        mustChangePassword: !trocou,
      ),
    );
    when(
      () => repository.readClaims(),
    ).thenAnswer((_) async => AuthRepository.decodeClaims(fakeAccessToken()));
    when(
      () => repository.changePassword(
        currentPassword: any(named: 'currentPassword'),
        newPassword: any(named: 'newPassword'),
      ),
    ).thenAnswer((_) async {
      trocou = true;
    });

    final controller = buildController(repository);
    await controller.restore();

    final antes = controller.state as AuthAuthenticated;
    expect(
      antes.session.user.mustChangePassword,
      isTrue,
      reason: 'quem entra com senha temporária precisa ser preso na troca',
    );

    await controller.changePassword(
      currentPassword: 'ABCD-EFGH-IJKL',
      newPassword: 'minha-senha-nova',
    );

    final depois = controller.state as AuthAuthenticated;
    expect(depois.session.user.mustChangePassword, isFalse);

    /// A sessão não foi recomposta do zero: organização e plano seguem lá.
    expect(depois.session.organization?.displayName, 'Acme Industries');
  });
}
