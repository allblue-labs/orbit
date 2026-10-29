import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/contracts/session_contracts.dart';
import 'package:orbit_operator/core/network/session_authenticator.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/authentication/application/auth_controller.dart';
import 'package:orbit_operator/features/authentication/data/auth_repository.dart';
import 'package:orbit_operator/features/authentication/domain/session.dart';
import 'package:orbit_operator/features/authentication/presentation/change_password_screen.dart';
import 'package:orbit_operator/features/authentication/presentation/logout_confirmation.dart';
import 'package:orbit_operator/features/evidence/application/evidence_providers.dart';
import 'package:orbit_operator/features/evidence/application/media_upload_controller.dart';
import 'package:orbit_operator/features/evidence/data/evidence_repository.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/sync/application/sync_controller.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';
import 'package:orbit_operator/features/sync/data/sync_repository.dart';

import '../support/fakes.dart';

class _AuthRepository extends Mock implements AuthRepository {}

class _SyncRepository extends Mock implements SyncRepository {}

class _EvidenceRepository extends Mock implements EvidenceRepository {}

const _scope = CommandScope(
  userId: 'u1',
  organizationId: 'o1',
  businessUnitId: 'b1',
);

class _Auth extends AuthController {
  _Auth(AuthRepository repository)
    : super(
        repository: repository,
        authenticator: SessionAuthenticator(
          storage: InMemoryTokenStorage(),
          logger: const OrbitLogger(isProduction: true),
          refreshCall: (_) async => throw StateError('not used'),
        ),
      ) {
    use(sessionFrom());
  }
  void use(OrbitSession session) => state = AuthAuthenticated(session);
}

class _Sync extends SyncController {
  _Sync(SyncState initial)
    : super(
        journal: CommandJournal(file: MemoryJournalFile()),
        projection: SyncProjectionStore(file: MemoryJournalFile()),
        repository: _SyncRepository(),
        scope: _scope,
        scopeKey: 'u1.o1.b1',
        onReconciled: () {},
      ) {
    state = initial;
  }
}

class _Media extends MediaUploadController {
  _Media(MediaSyncState initial)
    : super(
        queue: MediaQueue(
          file: MemoryJournalFile(),
          files: MemoryMediaFileStore(),
        ),
        repository: _EvidenceRepository(),
        scope: _scope,
        onEvidenceConfirmed: (_) {},
      ) {
    state = initial;
  }
}

void main() {
  late _AuthRepository repository;
  late _Auth auth;
  setUp(() {
    repository = _AuthRepository();
    when(() => repository.logout()).thenAnswer((_) async {});
    auth = _Auth(repository);
  });

  Widget host({
    SyncState sync = const SyncState(),
    MediaSyncState media = const MediaSyncState(),
    bool changePassword = false,
  }) => ProviderScope(
    overrides: [
      authControllerProvider.overrideWith((ref) => auth),
      syncControllerProvider.overrideWith((ref) => _Sync(sync)),
      mediaUploadControllerProvider.overrideWith((ref) => _Media(media)),
      uploadTasksProvider.overrideWith((ref) => Stream.value([])),
    ],
    child: MaterialApp(
      home: changePassword
          ? const ChangePasswordScreen()
          : Scaffold(
              body: Consumer(
                builder: (context, ref, _) => TextButton(
                  onPressed: () => confirmLogout(context, ref),
                  child: const Text('Sair'),
                ),
              ),
            ),
    ),
  );

  testWidgets('sempre confirma e cancelar mantém a sessão conectada', (
    tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.tap(find.text('Sair'));
    await tester.pumpAndSettle();
    expect(find.text('Sair da conta?'), findsOneWidget);
    verifyNever(() => repository.logout());
    await tester.tap(find.text('Continuar conectado'));
    await tester.pumpAndSettle();
    expect(auth.state, isA<AuthAuthenticated>());
    verifyNever(() => repository.logout());

    await tester.tap(find.text('Sair'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Sair'));
    await tester.pumpAndSettle();
    expect(auth.state, isA<AuthUnauthenticated>());
    verify(() => repository.logout()).called(1);
  });

  for (final pending in ['ações', 'fotos', 'recuperação']) {
    testWidgets('avisa sobre $pending antes de sair', (tester) async {
      await tester.pumpWidget(
        host(
          sync: pending == 'ações'
              ? const SyncState(pending: 1)
              : const SyncState(),
          media: pending == 'fotos'
              ? const MediaSyncState(pending: 1)
              : pending == 'recuperação'
              ? const MediaSyncState(needsRecovery: true)
              : const MediaSyncState(),
        ),
      );
      await tester.tap(find.text('Sair'));
      await tester.pumpAndSettle();
      expect(find.text('Sair mesmo assim'), findsOneWidget);
      expect(
        find.textContaining(
          pending == 'recuperação'
              ? 'precisam de recuperação'
              : 'ainda não chegaram',
        ),
        findsOneWidget,
      );
      verifyNever(() => repository.logout());
      await tester.tap(find.text('Continuar conectado'));
      await tester.pumpAndSettle();
    });
  }

  testWidgets('diálogo de uma sessão anterior não encerra a nova conta', (
    tester,
  ) async {
    await tester.pumpWidget(host());
    await tester.tap(find.text('Sair'));
    await tester.pumpAndSettle();
    auth.use(
      OrbitSession(
        user: const OrbitUser(
          id: 'outro-usuario',
          email: 'outro@example.test',
          displayName: 'Outro usuário',
        ),
        claims: AccessTokenClaims.fromJson({
          'sub': 'outro-usuario',
          'sid': 'outra-sessao',
          'organizationId': 'outra-org',
          'businessUnitId': 'outra-unidade',
        }),
      ),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Sair'));
    await tester.pumpAndSettle();
    verifyNever(() => repository.logout());
    expect((auth.state as AuthAuthenticated).session.user.id, 'outro-usuario');
  });

  testWidgets('a saída na troca de senha obrigatória também pede confirmação', (
    tester,
  ) async {
    await tester.pumpWidget(host(changePassword: true));
    await tester.ensureVisible(find.byKey(const Key('change-password.logout')));
    await tester.tap(find.byKey(const Key('change-password.logout')));
    await tester.pumpAndSettle();
    expect(find.text('Sair da conta?'), findsOneWidget);
    verifyNever(() => repository.logout());
    await tester.tap(find.text('Continuar conectado'));
    await tester.pumpAndSettle();
    expect(find.byType(ChangePasswordScreen), findsOneWidget);
  });
}
