import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/notification_contracts.dart';
import 'package:orbit_operator/features/notifications/application/foreground_notification_monitor.dart';

final now = DateTime.utc(2026, 10, 27, 12);
OrbitNotification notice(String id, {DateTime? at, bool read = false}) =>
    OrbitNotification(
      id: id,
      type: 'WORK_ASSIGNED',
      title: 'Atendimento',
      body: 'Abra o Orbit',
      createdAt: at ?? now,
      readAt: read ? now : null,
    );

void main() {
  test(
    'apresenta novos avisos uma única vez e ignora histórico e lidos',
    () async {
      var page = [
        notice('old', at: now.subtract(const Duration(days: 1))),
        notice('read', read: true),
      ];
      final received = <String>[];
      final monitor = ForegroundNotificationMonitor(
        load: () async => page,
        onNew: (n, present) {
          if (present) received.add(n.id);
        },
        now: () => now,
        interval: const Duration(hours: 1),
      );
      addTearDown(monitor.dispose);
      monitor.start();
      await pumpEventQueue();
      expect(received, isEmpty);
      page = [notice('new'), ...page];
      await monitor.poll();
      await monitor.poll();
      expect(received, ['new']);
    },
  );

  test(
    'aviso apresentado pelo sistema atualiza dados sem repetir banner no app',
    () async {
      final received = <bool>[];
      final completer = Completer<List<OrbitNotification>?>();
      final monitor = ForegroundNotificationMonitor(
        load: () => completer.future,
        onNew: (_, present) => received.add(present),
        now: () => now,
        interval: const Duration(hours: 1),
      );
      addTearDown(monitor.dispose);
      monitor.start();
      monitor.nativePresented('native');
      completer.complete([notice('native')]);
      await pumpEventQueue();
      expect(received, [false]);
    },
  );

  test(
    'logout descarta resposta em trânsito e a próxima sessão possui estado próprio',
    () async {
      final pending = Completer<List<OrbitNotification>?>();
      final received = <String>[];
      final oldSession = ForegroundNotificationMonitor(
        load: () => pending.future,
        onNew: (n, _) => received.add(n.id),
        now: () => now,
      );
      oldSession.start();
      oldSession.dispose();
      pending.complete([notice('old-user')]);
      await pumpEventQueue();
      expect(received, isEmpty);
      final newSession = ForegroundNotificationMonitor(
        load: () async => [notice('new-user')],
        onNew: (n, _) => received.add(n.id),
        now: () => now,
      );
      addTearDown(newSession.dispose);
      newSession.start();
      await pumpEventQueue();
      expect(received, ['new-user']);
    },
  );

  test(
    'pausa interrompe leituras e retomar permite nova tentativa após falha',
    () async {
      var calls = 0;
      final monitor = ForegroundNotificationMonitor(
        load: () async {
          calls++;
          if (calls == 1) throw StateError('offline');
          return [notice('new')];
        },
        onNew: (_, _) {},
        now: () => now,
        interval: const Duration(hours: 1),
      );
      addTearDown(monitor.dispose);
      monitor.start();
      await pumpEventQueue();
      monitor.stop();
      await monitor.poll();
      expect(calls, 1);
      monitor.start();
      await pumpEventQueue();
      expect(calls, 2);
    },
  );
}
