import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/design/orbit_wizard.dart';
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/field/application/execution_controller.dart';
import 'package:orbit_operator/features/field/data/field_operation_repository.dart';
import 'package:orbit_operator/features/field/presentation/widgets/attendance_wizard.dart';
import 'package:orbit_operator/features/field/presentation/widgets/attendance_work_record.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/evidence/application/evidence_providers.dart';
import 'package:orbit_operator/features/evidence/application/media_upload_controller.dart';
import 'package:orbit_operator/features/evidence/data/evidence_repository.dart';
import 'package:orbit_operator/features/evidence/data/evidence_intake.dart';
import 'package:orbit_operator/features/evidence/data/local_media.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:image/image.dart' as img;
import '../support/fakes.dart';
import '../support/scripted_adapter.dart';
import 'customer_signature_test.dart' as fixture;

class Backend extends fixture.Backend {
  @override
  Future<ResponseBody> call(RequestOptions options) async {
    if (options.path.endsWith('/execution-preparation')) {
      return jsonResponse({
        'success': true,
        'data': {
          'operation': {
            'id': 'op-1',
            'code': 'OS-1',
            'title': 'Atendimento',
            'status': 'IN_PROGRESS',
          },
          'allowedActions': [],
          'checklist': [],
          'materials': [],
        },
      });
    }
    return super.call(options);
  }
}

void main() {
  testWidgets(
    'foto recusada impede congelar o relatório sem evidência e permite corrigir o anexo',
    (tester) async {
      const scope = CommandScope(
        userId: 'u1',
        organizationId: 'org1',
        businessUnitId: 'bu1',
      );
      const target = FieldEvidenceTargetRef(
        type: FieldEvidenceTarget.operation,
        id: 'op-1',
      );
      final queue = MediaQueue(
        file: MemoryJournalFile(),
        files: MemoryMediaFileStore(),
      );
      final media = await intakeEvidence(
        files: queue.files,
        bytes: img.encodeJpg(img.Image(width: 10, height: 10)),
        filename: 'foto.jpg',
        mimeType: 'image/jpeg',
        scope: scope,
        target: target,
        category: EvidenceCategory.after,
        source: EvidenceSource.camera,
      );
      await queue.enqueue(
        media.copyWith(
          state: LocalMediaState.rejected,
          failureCode: 'FILE_TOO_LARGE',
        ),
      );
      final client = OrbitApiClient.create(
        environment: OrbitEnvironment.fromDefines(),
        storage: InMemoryTokenStorage(),
        logger: const OrbitLogger(isProduction: true),
        dio: Dio()
          ..httpClientAdapter = ScriptedAdapter(
            (_) async => throw StateError(
              'A foto recusada não deve ser reenviada sem correção',
            ),
          ),
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            mediaQueueProvider.overrideWithValue(queue),
            mediaUploadControllerProvider.overrideWith(
              (ref) => MediaUploadController(
                queue: queue,
                repository: EvidenceRepository(client: client),
                scope: scope,
                onEvidenceConfirmed: (_) {},
              ),
            ),
          ],
          child: const MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: AttendanceWizard(
                  confirmationStep: 1,
                  evidenceTarget: target,
                  steps: [
                    OrbitWizardStep(title: 'Evidências', child: Text('Fotos')),
                    OrbitWizardStep(
                      title: 'Confirmação',
                      child: Text('Revisão do cliente'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
      await fixture.tocarEm(tester, 'Avançar · Confirmação');
      expect(find.text('Revisão do cliente'), findsNothing);
      expect(find.textContaining('Há fotos não aceitas'), findsOneWidget);
      await queue.remove(media.localMediaId);
      await fixture.tocarEm(tester, 'Avançar · Confirmação');
      expect(find.text('Revisão do cliente'), findsOneWidget);
    },
  );
  for (final succeeds in [true, false]) {
    testWidgets(
      succeeds
          ? 'avançar salva a observação uma única vez e permite continuar'
          : 'falha ao salvar mantém o texto e o usuário na etapa do serviço',
      (tester) async {
        final backend = Backend();
        final client = OrbitApiClient.create(
          environment: OrbitEnvironment.fromDefines(),
          storage: InMemoryTokenStorage(),
          logger: const OrbitLogger(isProduction: true),
          dio: Dio()..httpClientAdapter = ScriptedAdapter(backend.call),
        );
        var calls = 0;
        String? note;
        final wizard = Scaffold(
          body: SingleChildScrollView(
            child: AttendanceWizard(
              confirmationStep: 2,
              steps: [
                OrbitWizardStep(
                  title: 'Serviço realizado',
                  child: AttendanceWorkRecord(
                    operationId: 'op-1',
                    onSaveNotes: (text) async {
                      calls++;
                      note = text;
                      return succeeds;
                    },
                  ),
                ),
                const OrbitWizardStep(
                  title: 'Resumo',
                  child: Text('Dados salvos para revisão'),
                ),
              ],
            ),
          ),
        );
        final base =
            fixture.cenario(backend, screenOverride: wizard).widget
                as ProviderScope;
        await tester.pumpWidget(
          ProviderScope(
            overrides: [
              ...base.overrides,
              fieldOperationRepositoryProvider.overrideWithValue(
                FieldOperationRepository(client: client),
              ),
              deviceInstanceIdProvider.overrideWith((ref) async => 'device'),
            ],
            child: base.child,
          ),
        );
        await tester.pumpAndSettle();
        await tester.enterText(
          find.byType(TextField),
          'Filtro limpo e dreno verificado.',
        );
        expect(find.text('Salvar observação'), findsNothing);
        expect(calls, 0);
        await fixture.tocarEm(tester, 'Avançar · Resumo');
        expect(calls, 1);
        expect(note, 'Filtro limpo e dreno verificado.');
        if (succeeds) {
          expect(find.text('Dados salvos para revisão'), findsOneWidget);
          await fixture.tocarEm(tester, 'Voltar');
          await fixture.tocarEm(tester, 'Avançar · Resumo');
          expect(calls, 1);
        } else {
          expect(find.text('Dados salvos para revisão'), findsNothing);
          expect(find.text('Filtro limpo e dreno verificado.'), findsOneWidget);
          expect(
            find.textContaining('Não foi possível salvar'),
            findsOneWidget,
          );
        }
      },
    );
  }
}
