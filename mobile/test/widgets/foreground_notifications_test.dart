import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/push/push_channel.dart';
import 'package:orbit_operator/features/notifications/application/push_providers.dart';
import 'package:orbit_operator/features/notifications/presentation/foreground_notifications.dart';
import 'package:orbit_operator/features/profile/application/notification_settings_providers.dart';
import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

void main() {
  testWidgets(
    'novo atendimento aparece no app aberto e parar o widget interrompe o monitor',
    (tester) async {
      var requests = 0;
      var hasNewAssignment = false;
      final createdAt = DateTime.now().toUtc().add(const Duration(seconds: 1));
      Future<ResponseBody> handle(RequestOptions options) async {
        requests++;
        return jsonResponse({
          'success': true,
          'data': {
            'unread': hasNewAssignment ? 1 : 0,
            'data': [
              if (hasNewAssignment)
                {
                  'id': 'notice-1',
                  'type': 'WORK_ASSIGNED',
                  'title': 'Novo atendimento atribuído',
                  'body':
                      'Abra o Orbit para consultar os detalhes atualizados.',
                  'createdAt': createdAt.toIso8601String(),
                },
            ],
          },
        });
      }

      final client = OrbitApiClient.create(
        environment: OrbitEnvironment.fromDefines(),
        storage: InMemoryTokenStorage(),
        logger: const OrbitLogger(isProduction: true),
        dio: Dio()..httpClientAdapter = ScriptedAdapter(handle),
        retryDio: Dio()..httpClientAdapter = ScriptedAdapter(handle),
      );
      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(client),
          readCacheProvider.overrideWithValue(InMemoryReadCache()),
          sessionProvider.overrideWithValue(
            sessionFrom(
              permissions: ['notifications.read'],
              roles: ['FIELD_TECHNICIAN'],
            ),
          ),
          pushTokenSourceProvider.overrideWithValue(
            const SilentPushTokenSource(),
          ),
          notificationPreferencesProvider.overrideWith((ref) async => {}),
        ],
      );
      addTearDown(container.dispose);
      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: MaterialApp(
            scaffoldMessengerKey: container.read(
              notificationMessengerKeyProvider,
            ),
            builder: (_, child) => ForegroundNotifications(child: child!),
            home: const Scaffold(body: Text('Atendimento aberto')),
          ),
        ),
      );
      await tester.pumpAndSettle();
      expect(requests, 1);
      expect(find.text('Novo atendimento atribuído'), findsNothing);
      hasNewAssignment = true;
      await tester.pump(const Duration(seconds: 12));
      await tester.pumpAndSettle();
      expect(find.text('Novo atendimento atribuído'), findsOneWidget);
      expect(find.text('Ver'), findsOneWidget);
      await tester.pumpWidget(const SizedBox.shrink());
      final stoppedAt = requests;
      await tester.pump(const Duration(seconds: 24));
      expect(requests, stoppedAt);
      expect(tester.takeException(), isNull);
    },
  );
}
