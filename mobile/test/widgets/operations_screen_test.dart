/// Listagem de operações e estados de seção.
library;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/operations/data/operations_repository.dart';
import 'package:orbit_operator/features/operations/presentation/operations_screen.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

Map<String, dynamic> _page(List<Map<String, dynamic>> data) => {
  'data': data,
  'meta': {
    'page': 1,
    'limit': 20,
    'total': data.length,
    'totalPages': 1,
    'hasNextPage': false,
    'hasPreviousPage': false,
  },
};

Map<String, dynamic> _operation({
  String id = 'op-1',
  String title = 'Manutenção preventiva',
  String status = 'IN_PROGRESS',
}) => {
  'id': id,
  'code': 'OP-0001',
  'title': title,
  'status': status,
  'kind': 'MAINTENANCE',
  'priority': 'HIGH',
  'scheduledStart': '2026-08-01T13:00:00.000Z',
  'users': const [],
  'attachments': const [],
  'checklistExecutions': const [],
};

Widget wrap(Future<ResponseBody> Function(RequestOptions) handler) {
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
      operationsRepositoryProvider.overrideWithValue(
        OperationsRepository(client: client, cache: InMemoryReadCache()),
      ),
    ],
    child: MaterialApp(
      theme: OrbitTheme.light(),
      home: const OperationsScreen(),
    ),
  );
}

void main() {
  testWidgets('lista as operações devolvidas pelo backend', (tester) async {
    await tester.pumpWidget(
      wrap(
        (_) async => jsonResponse(
          envelope(
            _page([
              _operation(),
              _operation(id: 'op-2', title: 'Inspeção semestral'),
            ]),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Manutenção preventiva'), findsOneWidget);
    expect(find.text('Inspeção semestral'), findsOneWidget);
    expect(find.text('Em execução'), findsWidgets);
  });

  testWidgets('mostra estado vazio quando não há resultados', (tester) async {
    await tester.pumpWidget(
      wrap((_) async => jsonResponse(envelope(_page(const [])))),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Nenhuma operação encontrada com estes filtros.'),
      findsOneWidget,
    );
  });

  testWidgets('sem rede, avisa e oferece nova tentativa', (tester) async {
    await tester.pumpWidget(
      wrap(
        (options) async => throw DioException.connectionError(
          requestOptions: options,
          reason: 'sem rede',
        ),
      ),
    );
    await tester.pumpAndSettle();

    /// Fora de produção a mensagem também nomeia o destino — é o que revela
    /// uma URL mal configurada, que é a causa quase sempre.
    expect(find.textContaining('Sem conexão'), findsOneWidget);
    expect(find.text('Tentar novamente'), findsOneWidget);
  });

  testWidgets('403 aparece como acesso negado, sem botão de repetir', (
    tester,
  ) async {
    await tester.pumpWidget(
      wrap(
        (_) async => jsonResponse(
          errorEnvelope(
            code: 'FORBIDDEN',
            message: 'Missing required permission',
          ),
          status: 403,
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(
      find.text('Você não possui permissão para realizar esta ação.'),
      findsOneWidget,
    );
    expect(find.text('Tentar novamente'), findsNothing);
  });

  testWidgets('filtro por status recarrega com o parâmetro do backend', (
    tester,
  ) async {
    final queries = <Map<String, dynamic>>[];
    await tester.pumpWidget(
      wrap((options) async {
        queries.add(Map.of(options.queryParameters));
        return jsonResponse(envelope(_page([_operation()])));
      }),
    );
    await tester.pumpAndSettle();

    /// A fileira de filtros rola na horizontal e os chips ficaram maiores:
    /// "Concluída" pode estar fora da viewport, e tocar no que não está
    /// visível não é o que um dedo faz.
    await tester.ensureVisible(find.text('Concluída'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Concluída'));
    await tester.pumpAndSettle();

    expect(queries.last['status'], 'COMPLETED');
  });
}
