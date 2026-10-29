import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/providers.dart';
import '../../../core/uploads/upload_task.dart';
import '../../evidence/data/local_media.dart';
import '../data/command_journal.dart';
import 'sync_providers.dart';

// O motivo faz parte da identidade: outro problema no mesmo item deve avisar
// novamente. Progresso, tentativas e mensagens de transporte não a alteram.
String _key(List<Object?> parts) =>
    sha256.convert(utf8.encode(jsonEncode(parts))).toString();

String commandNoticeKey(PendingCommand command) => _key([
  'command',
  command.envelope.commandId,
  command.isBlocking ? command.state.name : 'pending',
  if (command.isBlocking) command.receipt?.conflict?.code?.name,
  if (command.isBlocking) command.receipt?.error?.code,
]);

String mediaNoticeKey(LocalMedia media) => _key([
  'media',
  media.localMediaId,
  media.isBlocked ? media.state.name : 'pending',
  if (media.isBlocked) media.failureCode,
]);

String uploadNoticeKey(UploadTask task) => _key([
  'upload',
  task.id,
  task.status == UploadStatus.failed ? 'failed' : 'pending',
  if (task.status == UploadStatus.failed) task.lastError,
]);

class SyncNoticePreferences {
  const SyncNoticePreferences({
    this.hidden = const {},
    this.dismissedBanners = const {},
  });
  final Set<String> hidden;
  final Set<String> dismissedBanners;

  bool showsInBanner(String key) =>
      !hidden.contains(key) && !dismissedBanners.contains(key);
}

/// Preferências de apresentação. Nunca modifica as filas ou os arquivos.
class SyncNoticeController extends StateNotifier<SyncNoticePreferences> {
  SyncNoticeController({SharedPreferences? preferences, String? storageKey})
    : _preferences = preferences,
      _storageKey = storageKey,
      super(_read(preferences, storageKey));

  final SharedPreferences? _preferences;
  final String? _storageKey;
  Future<void> _tail = Future.value();

  static SyncNoticePreferences _read(
    SharedPreferences? preferences,
    String? key,
  ) {
    try {
      final raw = key == null ? null : preferences?.getString(key);
      if (raw == null) return const SyncNoticePreferences();
      final json = jsonDecode(raw) as Map<String, dynamic>;
      return SyncNoticePreferences(
        hidden: (json['hidden'] as List).cast<String>().toSet(),
        dismissedBanners: (json['banners'] as List).cast<String>().toSet(),
      );
    } on Object {
      return const SyncNoticePreferences();
    }
  }

  Future<void> _update(
    SyncNoticePreferences Function(SyncNoticePreferences) change,
  ) {
    final next = _tail.then((_) async {
      if (!mounted) return;
      final value = change(state);
      if (_preferences != null && _storageKey != null) {
        final saved = await _preferences.setString(
          _storageKey,
          jsonEncode({
            'hidden': value.hidden.toList(),
            'banners': value.dismissedBanners.toList(),
          }),
        );
        if (!saved) throw StateError('Não foi possível salvar a preferência.');
      }
      if (mounted) state = value;
    });
    _tail = next.then((_) {}, onError: (Object _) {});
    return next;
  }

  Future<void> hide(String key) => _update(
    (value) => SyncNoticePreferences(
      hidden: {...value.hidden, key},
      dismissedBanners: value.dismissedBanners,
    ),
  );

  Future<void> restore(String key) => _update(
    (value) => SyncNoticePreferences(
      hidden: {...value.hidden}..remove(key),
      dismissedBanners: {...value.dismissedBanners}..remove(key),
    ),
  );

  Future<void> dismissBanner(Iterable<String> keys) {
    final snapshot = keys.toSet();
    return _update(
      (value) => SyncNoticePreferences(
        hidden: value.hidden,
        dismissedBanners: {...value.dismissedBanners, ...snapshot},
      ),
    );
  }

  Future<void> restoreBanners() =>
      _update((value) => SyncNoticePreferences(hidden: value.hidden));
}

final syncNoticePreferencesProvider =
    StateNotifierProvider<SyncNoticeController, SyncNoticePreferences>((ref) {
      final scope = ref.watch(commandScopeProvider);
      if (scope == null) return SyncNoticeController();
      final environment = ref.watch(environmentProvider);
      final namespace = _key([
        environment.apiBaseUrl,
        scope.userId,
        scope.organizationId,
        scope.businessUnitId,
      ]);
      return SyncNoticeController(
        preferences: ref.watch(sharedPreferencesProvider),
        storageKey: 'sync_notice_preferences.v1.$namespace',
      );
    });
