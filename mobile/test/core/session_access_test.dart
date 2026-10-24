import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/authentication/application/auth_controller.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

void main() {
  for (final login in [true, false]) {
    for (final granted in [true, false]) {
      test(
        '${login ? 'login' : 'restauração'} usa acesso atual ${granted ? 'concedido' : 'revogado'}, não o token antigo',
        () async {
          final token = fakeAccessToken(
            roles: ['FIELD_TECHNICIAN'],
            allowedSurfaces: ['MOBILE'],
            // The token deliberately disagrees with the current server state.
            permissions: granted ? [] : ['*'],
            isOrganizationOwner: !granted,
            businessUnitId: 'unit-revogada',
          );
          final pair = {
            'accessToken': token,
            'refreshToken': 'refresh-1',
            'expiresIn': 900,
          };
          final requests = <RequestOptions>[];
          var denyAccess = false;
          Future<ResponseBody> respond(RequestOptions request) async {
            requests.add(request);
            if (request.path == '/identity/me/access' && denyAccess) {
              return jsonResponse(
                errorEnvelope(code: 'FORBIDDEN', message: 'Acesso negado.'),
                status: 403,
              );
            }
            final payload = switch (request.path) {
              '/identity/login' => pair,
              '/identity/me' => {
                'id': 'user-1',
                'email': 'tecnico@example.test',
                'displayName': 'Técnico Operacional',
              },
              '/identity/me/access' => {
                'isOwner': false,
                'roles': ['FIELD_TECHNICIAN'],
                'permissions': [
                  'operations.read',
                  'scheduling.read',
                  if (granted) 'operations.walk_in.create',
                ],
                'surfaceAccess': ['MOBILE'],
                'unitIds': ['unit-1'],
              },
              '/organizations/current' => {'id': 'org-1'},
              '/organizations/current/subscription' => {
                'planKey': 'ESSENTIAL',
                'subscriptionStatus': 'ACTIVE',
                'capabilities': ['operations.manage', 'scheduling.read'],
              },
              '/organizations/current/product-access' => {},
              _ => throw StateError('Unexpected request: ${request.path}'),
            };
            return jsonResponse(envelope(payload));
          }

          final storage = InMemoryTokenStorage();
          final client = OrbitApiClient.create(
            environment: OrbitEnvironment.fromDefines(),
            storage: storage,
            logger: const OrbitLogger(isProduction: true),
            dio: Dio()..httpClientAdapter = ScriptedAdapter(respond),
            retryDio: Dio()..httpClientAdapter = ScriptedAdapter(respond),
          );
          final repository = AuthRepository(client: client, storage: storage);
          final controller = AuthController(
            repository: repository,
            authenticator: client.authenticator,
          );
          addTearDown(controller.dispose);
          if (login) {
            await controller.login(
              email: 'tecnico@example.test',
              password: 'senha',
            );
          } else {
            await repository.login(
              email: 'tecnico@example.test',
              password: 'senha',
            );
            await controller.restore();
          }
          final session = (controller.state as AuthAuthenticated).session;
          expect(session.canCreateWalkIn, granted);
          expect(session.isOwner, isFalse);
          expect(session.hasPermission('scheduling.read'), isTrue);
          expect(session.hasCapability('scheduling.read'), isTrue);
          expect(session.hasActiveSubscription, isTrue);
          expect(session.businessUnitId, 'unit-1');
          expect(session.copyWith(user: session.user).canCreateWalkIn, granted);
          expect(
            requests
                .where((r) => r.path == '/identity/me/access')
                .single
                .headers['authorization'],
            'Bearer $token',
          );
          // Failure to consult current access must never fall back to the
          // token's wildcard, ownership or stale grants.
          denyAccess = true;
          await controller.restore();
          expect(controller.state, isA<AuthUnauthenticated>());
        },
      );
    }
  }
}
