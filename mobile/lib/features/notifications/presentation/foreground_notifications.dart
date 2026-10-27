import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../app/providers.dart';
import '../../../core/contracts/notification_contracts.dart';
import '../../../core/push/push_channel.dart';
import '../../../core/routing/orbit_router.dart';
import '../../field/application/field_providers.dart';
import '../../profile/application/notification_settings_providers.dart';
import '../application/foreground_notification_monitor.dart';
import '../application/notification_providers.dart';
import '../application/push_providers.dart';
import '../domain/deep_link.dart';

final notificationMessengerKeyProvider = Provider(
  (ref) => GlobalKey<ScaffoldMessengerState>(),
);

/// Lives in the session-owned container, above all routes (including wizards).
class ForegroundNotifications extends ConsumerStatefulWidget {
  const ForegroundNotifications({super.key, required this.child});
  final Widget child;
  @override
  ConsumerState<ForegroundNotifications> createState() =>
      _ForegroundNotificationsState();
}

class _ForegroundNotificationsState
    extends ConsumerState<ForegroundNotifications>
    with WidgetsBindingObserver {
  ForegroundNotificationMonitor? _monitor;
  StreamSubscription<String>? _incoming;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted || ref.read(sessionProvider) == null) return;
      final session = ref.read(sessionProvider)!;
      if (!session.hasPermission('notifications.read')) return;
      final scope = [
        session.user.id,
        session.organizationId ?? 'sem-org',
        session.businessUnitId ?? 'sem-unidade',
      ].join('.');
      _monitor = ForegroundNotificationMonitor(
        load: () async {
          if (!mounted) return null;
          if (ref.read(notificationPreferencesProvider).hasError) {
            ref.invalidate(notificationPreferencesProvider);
          }
          final preferences = await ref.read(
            notificationPreferencesProvider.future,
          );
          if (!mounted) return null;
          final result = await ref
              .read(notificationRepositoryProvider)
              .recent(scopeKey: scope, limit: 50);
          if (result.cachedAt != null) return null;
          return result.value.data.where((notice) {
            final choice = preferences[notice.type];
            return choice == null ||
                (choice.enabled &&
                    (choice.channels.contains('IN_APP') ||
                        choice.channels.contains('REALTIME')));
          }).toList();
        },
        onNew: _received,
      );
      final source = ref.read(pushTokenSourceProvider);
      if (source is PushMessageSource) {
        _incoming = (source as PushMessageSource).onNotificationReceived.listen(
          (id) => _monitor?.nativePresented(id),
        );
      }
      if (WidgetsBinding.instance.lifecycleState == null ||
          WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed) {
        _monitor!.start();
      }
    });
  }

  void _received(OrbitNotification notice, bool present) {
    if (!mounted) return;
    ref.invalidate(notificationsProvider);
    ref.invalidate(fieldHomeProvider);
    ref.invalidate(fieldDashboardProvider);
    ref.invalidate(workQueueControllerProvider);
    if (!present) return;
    final messenger = ref.read(notificationMessengerKeyProvider).currentState;
    messenger?.showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 8),
        content: Row(
          children: [
            const Icon(
              Icons.notifications_active_outlined,
              color: Colors.white,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    notice.title,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  if (notice.body.isNotEmpty) Text(notice.body),
                ],
              ),
            ),
          ],
        ),
        action: SnackBarAction(
          label: 'Ver',
          onPressed: () => ref
              .read(routerProvider)
              .push(
                routeForNotificationPayload(notice.payload) ??
                    OrbitRoutes.notifications,
              ),
        ),
      ),
    );
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _monitor?.start();
      if (ref.read(sessionProvider) != null) {
        unawaited(ref.read(pushRegistrarProvider).start());
      }
    } else {
      _monitor?.stop();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    unawaited(_incoming?.cancel());
    _monitor?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    if (session != null && session.hasPermission('notifications.read')) {
      ref.watch(notificationPreferencesProvider);
    }
    return widget.child;
  }
}
