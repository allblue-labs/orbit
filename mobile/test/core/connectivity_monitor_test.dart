import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/core/network/connectivity_monitor.dart';

class _Connectivity extends Mock implements Connectivity {}

void main() {
  test('dados móveis e outras interfaces ativas contam como rede', () async {
    final connectivity = _Connectivity();
    final monitor = PlatformConnectivityMonitor(connectivity: connectivity);
    for (final result in ConnectivityResult.values) {
      when(
        () => connectivity.checkConnectivity(),
      ).thenAnswer((_) async => [result]);
      expect(
        await monitor.isOnline(),
        result != ConnectivityResult.none,
        reason: result.name,
      );
    }
  });

  test(
    'troca Wi-Fi por dados móveis emite novo convite mesmo ainda conectado',
    () async {
      final events = StreamController<List<ConnectivityResult>>();
      addTearDown(events.close);
      final connectivity = _Connectivity();
      when(
        () => connectivity.onConnectivityChanged,
      ).thenAnswer((_) => events.stream);
      final monitor = PlatformConnectivityMonitor(connectivity: connectivity);
      final statuses = <bool>[];
      final sub = monitor.onStatusChange.listen(statuses.add);
      addTearDown(sub.cancel);
      for (final interfaces in [
        [ConnectivityResult.wifi],
        [ConnectivityResult.wifi],
        [ConnectivityResult.mobile],
        [ConnectivityResult.vpn, ConnectivityResult.mobile],
        [ConnectivityResult.mobile, ConnectivityResult.vpn],
        [ConnectivityResult.none],
        [ConnectivityResult.mobile],
      ]) {
        events.add(interfaces);
      }
      await Future<void>.delayed(Duration.zero);
      expect(statuses, [true, true, true, false, true]);
    },
  );
}
