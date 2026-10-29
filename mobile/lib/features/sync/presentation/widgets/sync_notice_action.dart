import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../application/sync_notice_preferences.dart';

Future<bool> saveNoticePreference(
  BuildContext context,
  Future<void> Function() change,
) async {
  try {
    await change();
    return true;
  } on Object {
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
            'Não foi possível salvar esta preferência. Tente novamente.',
          ),
        ),
      );
    }
    return false;
  }
}

class SyncNoticeAction extends ConsumerWidget {
  const SyncNoticeAction({super.key, required this.noticeKey});
  final String noticeKey;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hidden = ref
        .watch(syncNoticePreferencesProvider)
        .hidden
        .contains(noticeKey);
    return TextButton.icon(
      icon: Icon(
        hidden ? Icons.visibility_outlined : Icons.visibility_off_outlined,
        size: 18,
      ),
      label: Text(hidden ? 'Reexibir aviso' : 'Ocultar aviso'),
      onPressed: () async {
        final controller = ref.read(syncNoticePreferencesProvider.notifier);
        final saved = await saveNoticePreference(
          context,
          () => hidden
              ? controller.restore(noticeKey)
              : controller.hide(noticeKey),
        );
        if (!saved || hidden || !context.mounted) return;
        final messenger = ScaffoldMessenger.of(context);
        messenger.clearSnackBars();
        messenger.showSnackBar(
          SnackBar(
            duration: const Duration(seconds: 2),
            persist: false,
            showCloseIcon: true,
            content: const Text('Aviso ocultado. O registro foi preservado.'),
            action: SnackBarAction(
              label: 'Desfazer',
              onPressed: () => saveNoticePreference(
                context,
                () => controller.restore(noticeKey),
              ),
            ),
          ),
        );
      },
    );
  }
}
