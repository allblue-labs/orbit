import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/core/contracts/mobile_field_artifact_contracts.dart';
import 'package:orbit_operator/features/artifact/application/artifact_providers.dart';
import 'package:orbit_operator/features/artifact/presentation/widgets/document_section.dart';
import '../features/artifact_controller_test.dart' as fixture;

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));
  testWidgets(
    'emite e acompanha automaticamente, expondo apenas baixar e compartilhar',
    (tester) async {
      final backend = fixture.Backend();
      const source = ArtifactSourceRef(
        type: FieldArtifactSourceType.operation,
        id: 'op-1',
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            artifactControllerProvider(
              source,
            ).overrideWith((ref) => fixture.build(backend)),
          ],
          child: const MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: DocumentSection(source: source, automatic: true),
              ),
            ),
          ),
        ),
      );
      for (var i = 0; i < 15; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(backend.prepares, hasLength(1));
      expect(backend.renders, hasLength(1));
      expect(find.text('Emitir relatório'), findsNothing);
      expect(find.text('Atualizar'), findsNothing);
      backend.artifact = fixture.artifactJson(
        status: 'READY',
        actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
        generatedAt: '2026-10-28T12:00:00Z',
      );
      backend.preparation = fixture.preparationJson(
        existing: backend.artifact,
        actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
      );
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(find.text('Baixar'), findsOneWidget);
      expect(find.text('Compartilhar'), findsOneWidget);
      expect(find.text('Visualizar'), findsNothing);
      expect(find.text('Atualizar'), findsNothing);
      expect(backend.prepares, hasLength(1));
      expect(backend.renders, hasLength(1));
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
