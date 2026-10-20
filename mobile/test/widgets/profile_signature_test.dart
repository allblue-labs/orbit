import 'dart:async';
import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/profile/presentation/profile_screen.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmM'
  'IQAAAABJRU5ErkJggg==',
);

/// A assinatura virou um dos dois atalhos arredondados do Perfil.
///
/// Antes ela era um bloco com a imagem embutida. O que o atalho **precisa**
/// continuar fazendo é dizer o estado sem mentir — e é isso que estes testes
/// prendem: "Pendente" quando não há, "Cadastrada" quando há, e
/// "Não verificado" quando a leitura falhou. O traço que estava ali antes
/// passava por "não tem", e levaria alguém a cadastrar de novo o que já
/// existe. A imagem e o erro com nova tentativa moram na tela da assinatura,
/// a um toque daqui.
void main() {
  testWidgets('sem assinatura, o atalho diz pendente', (tester) async {
    await tester.pumpWidget(_host(available: false));
    await tester.pumpAndSettle();

    expect(find.text('Assinatura'), findsOneWidget);
    expect(find.text('Pendente'), findsOneWidget);
    expect(find.byKey(const Key('signature.preview.image')), findsNothing);
  });

  testWidgets('com assinatura, o atalho diz cadastrada', (tester) async {
    await tester.pumpWidget(_host(available: true));
    await tester.pumpAndSettle();

    expect(find.text('Cadastrada'), findsOneWidget);
    expect(find.text('Pendente'), findsNothing);
  });

  testWidgets('durante a leitura o atalho não afirma nada', (tester) async {
    final pending = Completer<ResponseBody>();
    await tester.pumpWidget(_host(statusResponse: pending.future));
    await tester.pump();

    expect(find.text('Verificando…'), findsOneWidget);
    expect(find.text('Pendente'), findsNothing);

    pending.complete(_statusResponse(available: false));
    await tester.pumpAndSettle();
    expect(find.text('Pendente'), findsOneWidget);
  });

  testWidgets('leitura falhada não vira "pendente" nem vaza o host', (
    tester,
  ) async {
    await tester.pumpWidget(_host(statusCode: 503));
    await tester.pumpAndSettle();

    /// O erro não pode virar "Pendente": isso faria a pessoa cadastrar de
    /// novo uma assinatura que está lá.
    expect(find.text('Não verificado'), findsOneWidget);
    expect(find.text('Pendente'), findsNothing);

    expect(find.textContaining('/mobile/field'), findsNothing);
    expect(find.textContaining('10.0.2.2'), findsNothing);
  });
}

Widget _host({
  bool available = false,
  int statusCode = 200,
  Future<ResponseBody>? statusResponse,
}) {
  Future<ResponseBody> handler(RequestOptions options) async {
    if (options.uri.path.endsWith('/mobile/field/me/signature/preview')) {
      return ResponseBody.fromBytes(
        _png,
        200,
        headers: {
          Headers.contentTypeHeader: ['image/png'],
        },
      );
    }
    if (options.uri.path.endsWith('/mobile/field/me/signature')) {
      if (statusResponse != null) return statusResponse;
      if (statusCode != 200) {
        return jsonResponse({
          'success': false,
          'error': {
            'code': 'SERVICE_UNAVAILABLE',
            'message': 'Não foi possível carregar os dados.',
          },
        }, status: statusCode);
      }
      return _statusResponse(available: available);
    }
    return jsonResponse({'success': true, 'data': const {}});
  }

  final dio = Dio()..httpClientAdapter = ScriptedAdapter(handler);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(handler);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );
  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(client),
      sessionProvider.overrideWithValue(sessionFrom()),
      commandJournalProvider.overrideWithValue(
        CommandJournal(file: MemoryJournalFile()),
      ),
      syncProjectionProvider.overrideWithValue(
        SyncProjectionStore(file: MemoryJournalFile()),
      ),
    ],
    child: MaterialApp(theme: OrbitTheme.light(), home: const ProfileScreen()),
  );
}

ResponseBody _statusResponse({required bool available}) {
  final expiresAt = DateTime.now().toUtc().add(const Duration(minutes: 5));
  final expires = expiresAt.millisecondsSinceEpoch ~/ 1000;
  return jsonResponse({
    'success': true,
    'data': {
      'signatureAvailable': available,
      'version': available ? 3 : null,
      'updatedAt': available ? '2026-09-08T15:20:00.000Z' : null,
      'roles': ['FIELD_TECHNICIAN'],
      'preview': available
          ? {
              'url':
                  '/api/v1/mobile/field/me/signature/preview'
                  '?expires=$expires&signature=${'a' * 64}',
              'expiresAt': expiresAt.toIso8601String(),
              'requiredHeaders': <String, String>{},
              'mimeType': 'image/png',
              'sizeBytes': _png.length.toString(),
              'sha256': sha256.convert(_png).toString(),
            }
          : null,
    },
  });
}
