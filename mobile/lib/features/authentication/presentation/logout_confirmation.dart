import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/uploads/upload_task.dart';
import '../../evidence/application/evidence_providers.dart';
import '../../sync/application/sync_providers.dart';
import '../domain/session.dart';

/// Only explicit user exits ask for confirmation. Session expiration continues
/// to use the authentication controller directly.
Future<void> confirmLogout(BuildContext context, WidgetRef ref) async {
  final auth = ref.read(authControllerProvider.notifier);
  final initialState = ref.read(authControllerProvider);
  if (initialState is! AuthAuthenticated) return;
  final sync = ref.read(syncControllerProvider);
  final media = ref.read(mediaUploadControllerProvider);
  final uploads = ref.read(uploadTasksProvider).valueOrNull ?? const [];
  final hasWork =
      sync.hasWork ||
      media.hasWork ||
      uploads.any(
        (task) => task.isActive || task.status == UploadStatus.failed,
      );
  final needsRecovery = sync.needsRecovery || media.needsRecovery;
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Sair da conta?'),
      content: Text(
        needsRecovery
            ? 'Há registros locais que precisam de recuperação. Eles permanecerão preservados neste aparelho após sair da conta.'
            : hasWork
            ? 'Há ações ou arquivos que ainda não chegaram ao servidor. Eles ficam guardados neste aparelho e só estarão disponíveis quando você entrar novamente com esta mesma conta.'
            : 'Você precisará entrar novamente para acessar seus atendimentos.',
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Continuar conectado'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: Text(hasWork ? 'Sair mesmo assim' : 'Sair'),
        ),
      ],
    ),
  );
  if (confirmed != true || !context.mounted || !auth.mounted) return;

  // A dialog opened for an earlier session must never sign out a new one.
  final currentState = ref.read(authControllerProvider);
  if (currentState is! AuthAuthenticated) return;
  final before = initialState.session;
  final current = currentState.session;
  if (before.user.id != current.user.id ||
      before.organizationId != current.organizationId ||
      before.businessUnitId != current.businessUnitId ||
      before.claims.sessionId != current.claims.sessionId) {
    return;
  }
  await auth.logout();
}
