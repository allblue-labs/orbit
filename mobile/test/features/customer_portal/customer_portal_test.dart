/// Área do cliente: rotas, sessão e contratos.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/session_authenticator.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/routing/orbit_router.dart';
import 'package:orbit_operator/core/storage/token_storage.dart';
import 'package:orbit_operator/features/customer_portal/application/portal_session.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_contracts.dart';
import 'package:orbit_operator/features/customer_portal/data/portal_repository.dart';

import '../../support/fakes.dart';

class _MockRepository extends Mock implements PortalRepository {}

PortalMe _me({bool mustChange = false}) => PortalMe.fromJson({
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
  'mustChangePassword': mustChange,
});

SessionAuthenticator _authenticator(TokenStorage storage) =>
    SessionAuthenticator(
      storage: storage,
      logger: const OrbitLogger(isProduction: true),
      refreshCall: (_) async => throw StateError('sem renovação no teste'),
    );

void main() {
  group('rotas da área do cliente', () {
    RouteDecision? decidir(
      PortalAuthState portal,
      String location, {
      bool equipe = false,
    }) => customerRouteDecision(
      portal: portal,
      teamSignedIn: equipe,
      location: location,
    );

    test('o cliente logado fica preso à própria área', () {
      final logado = PortalSignedIn(_me());
      for (final rota in [
        OrbitRoutes.home,
        OrbitRoutes.workQueue,
        OrbitRoutes.customers,
        OrbitRoutes.documents,
        OrbitRoutes.ownerArea,
        OrbitRoutes.profile,
        OrbitRoutes.login,
      ]) {
        expect(
          decidir(logado, rota)?.target,
          OrbitRoutes.customerArea,
          reason: '$rota não pode abrir para o cliente',
        );
      }
      expect(decidir(logado, OrbitRoutes.customerArea)?.target, isNull);
    });

    test('a senha temporária é trocada antes de qualquer outra tela', () {
      final temporario = PortalSignedIn(_me(mustChange: true));
      expect(
        decidir(temporario, OrbitRoutes.customerArea)?.target,
        OrbitRoutes.customerChangePassword,
      );
      expect(
        decidir(temporario, OrbitRoutes.customerChangePassword)?.target,
        isNull,
      );
    });

    test('sem cliente logado, a área do cliente não abre para ninguém', () {
      const fora = PortalSignedOut();
      expect(
        decidir(fora, OrbitRoutes.customerArea)?.target,
        OrbitRoutes.login,
      );
      expect(
        decidir(fora, OrbitRoutes.customerArea, equipe: true)?.target,
        OrbitRoutes.home,
      );
      /* As rotas da equipe seguem a regra da equipe. */
      expect(decidir(fora, OrbitRoutes.home, equipe: true), isNull);
      /* `/clientes` é a lista de clientes da equipe — não a área do cliente. */
      expect(decidir(fora, OrbitRoutes.customers, equipe: true), isNull);
      expect(
        decidir(fora, OrbitRoutes.customerChangePassword, equipe: true)?.target,
        OrbitRoutes.home,
      );
    });
  });

  group('sessão do cliente', () {
    late _MockRepository repository;
    late InMemoryTokenStorage storage;
    late SessionAuthenticator authenticator;

    setUp(() {
      repository = _MockRepository();
      storage = InMemoryTokenStorage();
      authenticator = _authenticator(storage);
      when(() => repository.authenticator).thenReturn(authenticator);
    });

    test('aparelho sem sessão de cliente sai da restauração na hora', () async {
      when(() => repository.hasStoredSession()).thenAnswer((_) async => false);
      final controller = PortalSessionController(
        repository: repository,
        authenticator: authenticator,
      );
      await controller.restore();
      expect(controller.state, isA<PortalSignedOut>());
      verifyNever(() => repository.me());
    });

    test('restaura a sessão guardada e respeita a troca pendente', () async {
      when(() => repository.hasStoredSession()).thenAnswer((_) async => true);
      when(
        () => repository.me(),
      ).thenAnswer((_) async => _me(mustChange: true));
      final controller = PortalSessionController(
        repository: repository,
        authenticator: authenticator,
      );
      await controller.restore();
      final estado = controller.state as PortalSignedIn;
      expect(estado.me.mustChangePassword, isTrue);
      expect(estado.me.customerName, 'Clínica Sol LTDA');
    });

    test('sessão recusada pelo servidor é apagada do aparelho', () async {
      await storage.write(
        const TokenPair(accessToken: 'a', refreshToken: 'r', expiresIn: 1),
      );
      when(() => repository.hasStoredSession()).thenAnswer((_) async => true);
      when(() => repository.me()).thenThrow(
        const OrbitException(
          kind: OrbitErrorKind.unauthorized,
          publicMessage: 'x',
          code: 'UNAUTHORIZED',
          status: 401,
        ),
      );
      final controller = PortalSessionController(
        repository: repository,
        authenticator: authenticator,
      );
      await controller.restore();
      expect(controller.state, isA<PortalSignedOut>());
      expect(await storage.read(), isNull);
    });

    test('trocar a senha libera o app com o `me` relido do servidor', () async {
      when(
        () => repository.login(
          email: any(named: 'email'),
          password: any(named: 'password'),
        ),
      ).thenAnswer(
        (_) async => PortalSession(
          tokens: const TokenPair(
            accessToken: 'a',
            refreshToken: 'r',
            expiresIn: 900,
          ),
          me: _me(mustChange: true),
        ),
      );
      when(
        () => repository.changePassword(
          currentPassword: any(named: 'currentPassword'),
          newPassword: any(named: 'newPassword'),
        ),
      ).thenAnswer((_) async {});
      when(() => repository.me()).thenAnswer((_) async => _me());
      final controller = PortalSessionController(
        repository: repository,
        authenticator: authenticator,
      );
      await controller.login(
        email: 'clinica.sol@clima-norte.com',
        password: 'temp',
      );
      expect(
        (controller.state as PortalSignedIn).me.mustChangePassword,
        isTrue,
      );
      await controller.changePassword(
        currentPassword: 'temp',
        newPassword: 'nova-senha-forte',
      );
      expect(
        (controller.state as PortalSignedIn).me.mustChangePassword,
        isFalse,
      );
    });
  });

  group('contratos da área do cliente', () {
    test('o documento traz categoria, título e o atendimento de origem', () {
      final documento = PortalDocument.fromJson(const {
        'id': 'doc-1',
        'fileName': 'os.pdf',
        'title': 'Ordem de serviço',
        'code': 'OS-000087',
        'category': 'receipt',
        'categoryLabel': 'Recibo',
        'operationId': 'op-1',
        'issuedAt': '2026-11-20T10:00:00.000Z',
        'sizeBytes': 1024,
      });
      expect(documento.category, PortalDocumentCategory.receipt);
      expect(documento.operationId, 'op-1');
      /* Categoria desconhecida cai em atendimento — como no servidor. */
      expect(
        PortalDocument.fromJson(const {'category': 'nova'}).category,
        PortalDocumentCategory.service,
      );
    });

    test('o atendimento traz o documento pronto para abrir', () {
      final atendimento = PortalOperation.fromJson(const {
        'id': 'op-1',
        'code': 'OS-1',
        'type': 'Manutenção',
        'title': 'Preventiva',
        'status': {'code': 'completed', 'label': 'Concluído'},
        'scheduledStart': '2026-11-19T12:00:00.000Z',
        'completedAt': '2026-11-20T15:00:00.000Z',
        'businessUnit': {'displayName': 'Matriz'},
        'assets': [
          {'id': 'a-1', 'displayName': 'Split recepção'},
        ],
        'responsibleTechnician': {'displayName': 'Marina'},
        'documentId': 'doc-1',
      });
      expect(atendimento.documentId, 'doc-1');
      expect(atendimento.when, atendimento.completedAt);
      expect(atendimento.assets.single.name, 'Split recepção');
    });
  });
}
