import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_offline_sync_contracts.dart';
import 'package:orbit_operator/core/uploads/upload_task.dart';
import 'package:orbit_operator/features/sync/application/sync_notice_preferences.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';

const scope = CommandScope(
  userId: 'u1',
  organizationId: 'org1',
  businessUnitId: 'bu1',
);

ProviderContainer container(
  SharedPreferences preferences, {
  CommandScope owner = scope,
  String url = 'https://orbit.example/api/v1',
}) => ProviderContainer(
  overrides: [
    sharedPreferencesProvider.overrideWithValue(preferences),
    commandScopeProvider.overrideWithValue(owner),
    environmentProvider.overrideWithValue(
      OrbitEnvironment(
        apiBaseUrl: url,
        flavor: OrbitFlavor.production,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
      ),
    ),
  ],
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  test(
    'ocultação e dispensa sobrevivem ao reinício e podem ser desfeitas',
    () async {
      final preferences = await SharedPreferences.getInstance();
      final first = container(preferences);
      await first.read(syncNoticePreferencesProvider.notifier).hide('item-a');
      await first.read(syncNoticePreferencesProvider.notifier).dismissBanner([
        'item-b',
      ]);
      first.dispose();
      final reopened = container(preferences);
      addTearDown(reopened.dispose);
      expect(reopened.read(syncNoticePreferencesProvider).hidden, {'item-a'});
      expect(
        reopened.read(syncNoticePreferencesProvider).showsInBanner('item-b'),
        isFalse,
      );
      expect(
        reopened.read(syncNoticePreferencesProvider).showsInBanner('new-item'),
        isTrue,
      );
      await reopened
          .read(syncNoticePreferencesProvider.notifier)
          .restore('item-a');
      await reopened
          .read(syncNoticePreferencesProvider.notifier)
          .restoreBanners();
      expect(
        reopened.read(syncNoticePreferencesProvider).showsInBanner('item-a'),
        isTrue,
      );
      expect(
        reopened.read(syncNoticePreferencesProvider).showsInBanner('item-b'),
        isTrue,
      );
    },
  );

  test(
    'ocultar e restaurar em sequência não perde a última preferência',
    () async {
      final runtime = container(await SharedPreferences.getInstance());
      addTearDown(runtime.dispose);
      final controller = runtime.read(syncNoticePreferencesProvider.notifier);
      await Future.wait([
        controller.hide('a'),
        controller.hide('b'),
        controller.restore('a'),
      ]);
      expect(runtime.read(syncNoticePreferencesProvider).hidden, {'b'});
    },
  );

  test(
    'não compartilha preferências entre usuários, organizações, unidades ou APIs',
    () async {
      final preferences = await SharedPreferences.getInstance();
      final first = container(preferences);
      await first.read(syncNoticePreferencesProvider.notifier).hide('notice');
      await first.read(syncNoticePreferencesProvider.notifier).dismissBanner([
        'banner',
      ]);
      first.dispose();
      for (final foreign in [
        const CommandScope(
          userId: 'u2',
          organizationId: 'org1',
          businessUnitId: 'bu1',
        ),
        const CommandScope(
          userId: 'u1',
          organizationId: 'org2',
          businessUnitId: 'bu1',
        ),
        const CommandScope(
          userId: 'u1',
          organizationId: 'org1',
          businessUnitId: 'bu2',
        ),
        const CommandScope(
          userId: 'u1',
          organizationId: 'org1',
          businessUnitId: null,
        ),
      ]) {
        final other = container(preferences, owner: foreign);
        expect(other.read(syncNoticePreferencesProvider).hidden, isEmpty);
        expect(
          other.read(syncNoticePreferencesProvider).dismissedBanners,
          isEmpty,
        );
        other.dispose();
      }
      final staging = container(
        preferences,
        url: 'https://staging.example/api/v1',
      );
      expect(staging.read(syncNoticePreferencesProvider).hidden, isEmpty);
      staging.dispose();
      final own = container(preferences);
      expect(own.read(syncNoticePreferencesProvider).hidden, {'notice'});
      own.dispose();
    },
  );

  test(
    'preferência ilegível não impede acesso e pode ser gravada novamente',
    () async {
      final preferences = await SharedPreferences.getInstance();
      final first = container(preferences);
      await first.read(syncNoticePreferencesProvider.notifier).hide('a');
      first.dispose();
      final key = preferences.getKeys().single;
      await preferences.setString(key, 'conteúdo incompleto');
      final next = container(preferences);
      addTearDown(next.dispose);
      expect(next.read(syncNoticePreferencesProvider).hidden, isEmpty);
      await next.read(syncNoticePreferencesProvider.notifier).hide('b');
      expect(next.read(syncNoticePreferencesProvider).hidden, {'b'});
    },
  );

  test(
    'falha nova no mesmo comando tem outro aviso; tentativa e progresso não',
    () async {
      final command = PendingCommand(
        envelope: OfflineCommandEnvelope(
          commandId: 'cmd-1',
          idempotencyKey: 'cmd-1',
          commandType: OfflineCommandType.operationStart,
          aggregateId: 'op-1',
          expectedVersion: 'v1',
          occurredAt: DateTime.utc(2026, 10, 29),
          payload: const {},
        ),
        scope: scope,
        state: PendingCommandState.pending,
        enqueuedAt: DateTime.utc(2026, 10, 29),
      );
      expect(
        commandNoticeKey(command),
        commandNoticeKey(
          command.copyWith(state: PendingCommandState.syncing, attempts: 2),
        ),
      );
      expect(
        commandNoticeKey(command),
        isNot(
          commandNoticeKey(
            command.copyWith(state: PendingCommandState.rejected),
          ),
        ),
      );
      final upload = UploadTask(
        id: 'upload-1',
        operationId: 'op-1',
        filePath: 'photo.png',
        fileName: 'photo.png',
        mimeType: 'image/png',
        sizeInBytes: 10,
        createdAt: DateTime.utc(2026, 10, 29),
      );
      expect(
        uploadNoticeKey(upload),
        uploadNoticeKey(
          upload.copyWith(
            status: UploadStatus.uploading,
            progress: 0.5,
            attempts: 1,
          ),
        ),
      );
      expect(
        uploadNoticeKey(upload),
        isNot(uploadNoticeKey(upload.copyWith(status: UploadStatus.failed))),
      );
    },
  );
}
