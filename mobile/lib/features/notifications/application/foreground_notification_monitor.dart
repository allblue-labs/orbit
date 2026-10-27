import 'dart:async';
import '../../../core/contracts/notification_contracts.dart';

/// Only the authenticated API supplies notification contents. A native push is
/// a wake-up hint; it never becomes a second source of tenant/user data.
class ForegroundNotificationMonitor {
  ForegroundNotificationMonitor({
    required this.load,
    required this.onNew,
    this.interval = const Duration(seconds: 12),
    DateTime Function()? now,
  }) : startedAt = (now ?? DateTime.now)();
  final Future<List<OrbitNotification>?> Function() load;
  final void Function(OrbitNotification notice, bool present) onNew;
  final Duration interval;
  final DateTime startedAt;
  final _seen = <String>{};
  final _presentedNatively = <String>{};
  Timer? _timer;
  bool _active = false;
  bool _loading = false;
  int _generation = 0;

  void start() {
    if (_active) return;
    _active = true;
    unawaited(poll());
    _timer = Timer.periodic(interval, (_) => unawaited(poll()));
  }

  void stop() {
    _active = false;
    _generation++;
    _timer?.cancel();
    _timer = null;
  }

  void nativePresented(String notificationId) {
    _presentedNatively.add(notificationId);
    unawaited(poll());
  }

  Future<void> poll() async {
    if (!_active || _loading) return;
    _loading = true;
    final generation = _generation;
    try {
      final notices = await load();
      if (!_active || generation != _generation || notices == null) return;
      for (final notice in notices.reversed) {
        if (!_seen.add(notice.id)) continue;
        if (notice.isUnread && !notice.createdAt.isBefore(startedAt)) {
          onNew(notice, !_presentedNatively.remove(notice.id));
        }
      }
      // Bounded by recent API pages; no cross-session persistence.
      if (_seen.length > 300) {
        _seen.removeAll(_seen.take(_seen.length - 200).toList());
      }
      if (_presentedNatively.length > 100) _presentedNatively.clear();
    } on Object {
      // Offline/server failures are retried while the app is visible.
    } finally {
      _loading = false;
    }
  }

  void dispose() {
    stop();
    _seen.clear();
    _presentedNatively.clear();
  }
}
