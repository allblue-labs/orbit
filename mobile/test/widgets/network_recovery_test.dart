import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/connectivity_monitor.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/evidence/application/evidence_providers.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/profile/application/notification_settings_providers.dart';
import 'package:orbit_operator/features/profile/application/profile_providers.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/sync/presentation/sync_triggers.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

class _Network implements ConnectivityMonitor {
  final events = StreamController<bool>.broadcast();
  @override
  Stream<bool> get onStatusChange => events.stream;
  @override
  Future<bool> isOnline() async => true;
}

void main() {
  for (final trigger in ['troca de rede', 'retorno ao app']) {
    testWidgets(
      'recupera avatar e preferências após $trigger sem descartar leituras válidas',
      (tester) async {
        var recovered = false;
        var avatarReads = 0;
        var preferenceReads = 0;
        final network = _Network();
        addTearDown(network.events.close);
        Future<ResponseBody> handle(RequestOptions request) async {
          if (request.path.endsWith('/identity/me/avatar')) {
            avatarReads++;
            if (!recovered) {
              return jsonResponse(
                errorEnvelope(
                  code: 'SERVICE_UNAVAILABLE',
                  message: 'Falha temporária.',
                ),
                status: 503,
              );
            }
            return jsonResponse(
              envelope({
                'available': true,
                'url': '/api/v1/storage/objects?signature=private',
                'expiresAt': DateTime.now()
                    .toUtc()
                    .add(const Duration(minutes: 5))
                    .toIso8601String(),
              }),
            );
          }
          if (request.path.contains('/storage/objects')) {
            return ResponseBody.fromBytes([1, 2, 3], 200);
          }
          if (request.path.endsWith('/notifications/preferences')) {
            preferenceReads++;
            if (!recovered) {
              return jsonResponse(
                errorEnvelope(
                  code: 'FORBIDDEN',
                  message: 'Acesso não disponível.',
                ),
                status: 403,
              );
            }
            return jsonResponse(envelope([]));
          }
          return jsonResponse(
            envelope({
              'status': 'DELTA',
              'changes': [],
              'tombstones': [],
              'nextCursor': 'c1',
              'hasMore': false,
              'purgeRequired': false,
            }),
          );
        }

        final client = OrbitApiClient.create(
          environment: OrbitEnvironment.fromDefines(),
          storage: InMemoryTokenStorage(),
          logger: const OrbitLogger(isProduction: true),
          dio: Dio()..httpClientAdapter = ScriptedAdapter(handle),
          retryDio: Dio()..httpClientAdapter = ScriptedAdapter(handle),
        );
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              apiClientProvider.overrideWithValue(client),
              sessionProvider.overrideWithValue(sessionFrom()),
              connectivityProvider.overrideWithValue(network),
              commandJournalProvider.overrideWithValue(
                CommandJournal(file: MemoryJournalFile()),
              ),
              syncProjectionProvider.overrideWithValue(
                SyncProjectionStore(file: MemoryJournalFile()),
              ),
              mediaQueueProvider.overrideWithValue(
                MediaQueue(
                  file: MemoryJournalFile(),
                  files: MemoryMediaFileStore(),
                ),
              ),
            ],
            child: MaterialApp(
              home: SyncTriggers(
                child: Scaffold(
                  body: Consumer(
                    builder: (context, ref, _) {
                      final avatar = ref.watch(avatarBytesProvider);
                      final preferences = ref.watch(
                        notificationPreferencesProvider,
                      );
                      return Column(
                        children: [
                          Text(
                            avatar.hasError
                                ? 'Foto pendente'
                                : avatar.hasValue
                                ? 'Foto carregada'
                                : 'Carregando foto',
                          ),
                          Text(
                            preferences.hasError
                                ? 'Preferências pendentes'
                                : preferences.hasValue
                                ? 'Preferências carregadas'
                                : 'Carregando preferências',
                          ),
                        ],
                      );
                    },
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        expect(find.text('Foto pendente'), findsOneWidget);
        expect(find.text('Preferências pendentes'), findsOneWidget);
        recovered = true;
        if (trigger == 'troca de rede') {
          network.events.add(true);
        } else {
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.paused,
          );
          tester.binding.handleAppLifecycleStateChanged(
            AppLifecycleState.resumed,
          );
        }
        await tester.pump();
        for (
          var frame = 0;
          frame < 10 && find.text('Foto carregada').evaluate().isEmpty;
          frame++
        ) {
          await tester.pump(const Duration(milliseconds: 100));
        }
        await tester.pumpAndSettle();
        final container = ProviderScope.containerOf(
          tester.element(find.byType(SyncTriggers)),
        );
        expect(
          find.text('Foto carregada'),
          findsOneWidget,
          reason:
              'avatarReads=$avatarReads; state=${container.read(avatarBytesProvider)}',
        );
        expect(find.text('Preferências carregadas'), findsOneWidget);
        expect(avatarReads, 2);
        expect(preferenceReads, 2);
        network.events.add(true);
        await tester.pumpAndSettle();
        expect(avatarReads, 2);
        expect(preferenceReads, 2);
        await tester.pumpWidget(const SizedBox.shrink());
      },
    );
  }
}
