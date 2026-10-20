/// O estado da tela de avisos.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../data/notification_preferences_repository.dart';

final notificationPreferencesRepositoryProvider =
    Provider<NotificationPreferencesRepository>(
      (ref) => NotificationPreferencesRepository(
        client: ref.watch(apiClientProvider),
      ),
    );

/// O mapa de tipo → escolha. Tipo ausente segue o padrão do servidor.
final notificationPreferencesProvider =
    FutureProvider.autoDispose<Map<String, NoticePreference>>(
      (ref) => ref.watch(notificationPreferencesRepositoryProvider).list(),
    );

class NotificationSettingsController extends StateNotifier<AsyncValue<void>> {
  NotificationSettingsController(this._ref)
    : super(const AsyncValue.data(null));

  final Ref _ref;

  /// Liga ou desliga um tipo.
  ///
  /// Desligar apaga **todos** os canais daquele tipo, e não só o push: um
  /// interruptor rotulado "Novo atendimento" que continuasse mandando
  /// e-mail seria um interruptor quebrado.
  Future<bool> toggle({required String type, required bool enabled}) async {
    state = const AsyncValue.loading();
    try {
      await _ref
          .read(notificationPreferencesRepositoryProvider)
          .set(
            type: type,
            enabled: enabled,
            channels: enabled
                ? const ['IN_APP', 'REALTIME', 'PUSH']
                : const <String>[],
          );
      _ref.invalidate(notificationPreferencesProvider);

      /// `mounted` antes de escrever: o provedor é `autoDispose`, e quem
      /// saiu da tela no meio da requisição já o descartou. Escrever num
      /// notificador morto derruba o aplicativo por causa de um interruptor.
      if (mounted) state = const AsyncValue.data(null);
      return true;
    } on Object catch (error, stack) {
      if (mounted) state = AsyncValue.error(error, stack);
      return false;
    }
  }
}

final notificationSettingsControllerProvider =
    StateNotifierProvider.autoDispose<
      NotificationSettingsController,
      AsyncValue<void>
    >(NotificationSettingsController.new);
