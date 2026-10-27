import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/features/pmoc/application/pmoc_providers.dart';
import 'package:orbit_operator/features/pmoc/presentation/pmoc_document_section.dart';
import '../features/pmoc_attendance_test.dart' as fixture;
import '../support/scripted_adapter.dart';

class DelayedReport extends fixture.Backend {
  int requests = 0;
  @override
  Future<ResponseBody> call(RequestOptions options) async {
    if (options.path.endsWith('/manifests') && requests++ == 0) {
      return jsonResponse({
        'success': true,
        'data': {'data': []},
      });
    }
    return super.call(options);
  }
}

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));
  testWidgets(
    'PMOC acompanha a emissão sem conferir de novo e oferece baixar e compartilhar',
    (tester) async {
      final backend = DelayedReport();
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            pmocRepositoryProvider.overrideWithValue(
              fixture.buildRepository(backend),
            ),
          ],
          child: const MaterialApp(
            home: Scaffold(
              body: SingleChildScrollView(
                child: PmocDocumentSection(
                  artifactExecutionId: 'art-1',
                  fileName: 'PMOC.pdf',
                  subject: 'PMOC',
                ),
              ),
            ),
          ),
        ),
      );
      for (var i = 0; i < 5; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(find.text('Conferir de novo'), findsNothing);
      expect(backend.requests, 1);
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();
      expect(backend.requests, greaterThanOrEqualTo(2));
      expect(find.text('Compartilhar relatório'), findsOneWidget);
      expect(find.text('Baixar relatório'), findsOneWidget);
      expect(find.text('Emitir relatório'), findsNothing);
      expect(find.text('Conferir de novo'), findsNothing);
      await tester.pumpWidget(const SizedBox.shrink());
    },
  );
}
