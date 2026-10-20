/// O incidente, reproduzido.
///
/// ## O que aconteceu
///
/// Um técnico abriu o aplicativo. O backend não estava no ar. A tela mostrou:
///
/// ```text
/// O servidor demorou a responder. (tentei 10.0.2.2:6001)
/// ```
///
/// ## O que este arquivo faz
///
/// Sobe a tela inicial de verdade contra um transporte que falha exatamente
/// como falhou naquele dia — com a URL de desenvolvimento intacta, porque
/// trocar a configuração para o teste passar seria maquiar o defeito — e
/// verifica cada texto visível.
///
/// Não é um teste de mapeamento: aquele já existe. É a prova de que a
/// mensagem, atravessando cliente, repositório, provider e widget, chega
/// limpa na ponta.
library;

import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/documents/presentation/documents_screen.dart';
import 'package:orbit_operator/features/field/application/field_providers.dart';
import 'package:orbit_operator/features/field/presentation/field_dashboard_screen.dart';
import 'package:orbit_operator/features/scheduling/presentation/agenda_screen.dart';
import 'package:orbit_operator/features/field/presentation/work_queue_screen.dart';

import '../support/fakes.dart';
import 'public_error_guard.dart';

/// A configuração real de desenvolvimento. **Não é maquiada para o teste.**
const urlDeDesenvolvimento = 'http://10.0.2.2:6001/api/v1';

/// As formas de o transporte falhar antes de existir resposta.
enum FalhaDeTransporte { timeout, recusada, dns, tls }

/// Um adaptador que falha como o mundo real falha.
class AdaptadorQueFalha implements HttpClientAdapter {
  AdaptadorQueFalha(this.falha);

  final FalhaDeTransporte falha;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final uri = options.uri;
    throw switch (falha) {
      FalhaDeTransporte.timeout => DioException.connectionTimeout(
        timeout: const Duration(seconds: 15),
        requestOptions: options,
      ),
      FalhaDeTransporte.recusada => DioException.connectionError(
        requestOptions: options,
        reason: 'The connection errored',
        error: SocketException(
          'Connection refused',
          osError: const OSError('Connection refused', 61),
          address: InternetAddress('10.0.2.2'),
          port: 6001,
        ),
      ),
      FalhaDeTransporte.dns => DioException.connectionError(
        requestOptions: options,
        reason: 'Failed host lookup',
        error: SocketException('Failed host lookup: ${uri.host}'),
      ),
      FalhaDeTransporte.tls => DioException.connectionError(
        requestOptions: options,
        reason: 'handshake',
        error: const HandshakeException(
          'CERTIFICATE_VERIFY_FAILED: self signed certificate',
        ),
      ),
    };
  }

  @override
  void close({bool force = false}) {}
}

Widget host(Widget tela, FalhaDeTransporte falha) {
  /// O ambiente é o de desenvolvimento, com a URL do incidente.
  const environment = OrbitEnvironment(
    apiBaseUrl: urlDeDesenvolvimento,
    flavor: OrbitFlavor.development,
    connectTimeout: Duration(seconds: 15),
    receiveTimeout: Duration(seconds: 30),
  );

  final client = OrbitApiClient.create(
    environment: environment,
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: false),
    dio: Dio()..httpClientAdapter = AdaptadorQueFalha(falha),
    retryDio: Dio()..httpClientAdapter = AdaptadorQueFalha(falha),
  );

  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(client),
      readCacheProvider.overrideWithValue(InMemoryReadCache()),
    ],
    child: MediaQuery(
      data: const MediaQueryData(size: Size(390, 800)),
      child: MaterialApp(theme: OrbitTheme.light(), home: tela),
    ),
  );
}

/// Tudo o que a tela está mostrando, em texto.
List<String> textosVisiveis(WidgetTester tester) => tester
    .widgetList<Text>(find.byType(Text))
    .map((widget) => widget.data ?? '')
    .where((texto) => texto.isNotEmpty)
    .toList();

void main() {
  setUpAll(() async => initializeDateFormatting('pt_BR'));

  group('abertura do aplicativo com o backend fora do ar', () {
    for (final falha in FalhaDeTransporte.values) {
      testWidgets('a tela inicial não vaza infraestrutura — ${falha.name}', (
        tester,
      ) async {
        await tester.pumpWidget(host(const FieldDashboardScreen(), falha));
        await tester.pumpAndSettle();

        final textos = textosVisiveis(tester);

        /// O incidente, verificado literalmente.
        expect(
          textos.any((t) => t.contains('10.0.2.2')),
          isFalse,
          reason: 'O endereço do incidente voltou à tela: $textos',
        );

        expectSafePublicErrorAll(textos, onde: 'tela inicial (${falha.name})');

        /// E a pessoa tem o que fazer.
        expect(find.text('Tentar novamente'), findsOneWidget);
      });
    }

    testWidgets('a mensagem de demora é a do aplicativo, inteira', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(const FieldDashboardScreen(), FalhaDeTransporte.timeout),
      );
      await tester.pumpAndSettle();

      expect(
        find.textContaining('demorando mais que o esperado'),
        findsOneWidget,
      );

      /// Sem o parêntese que causou o incidente.
      expect(find.textContaining('tentei'), findsNothing);
    });

    testWidgets('sem conexão fala de internet, não de servidor', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(const FieldDashboardScreen(), FalhaDeTransporte.recusada),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('conexão com a internet'), findsOneWidget);
    });

    testWidgets('certificado inválido não vira "confira o wi-fi"', (
      tester,
    ) async {
      await tester.pumpWidget(
        host(const FieldDashboardScreen(), FalhaDeTransporte.tls),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('conexão segura'), findsOneWidget);
      expectSafePublicErrorAll(textosVisiveis(tester), onde: 'TLS');
    });
  });

  group('o refresh que falha não apaga o dia de trabalho', () {
    /// Uma home com conteúdo — o suficiente para saber se sobreviveu.
    Map<String, dynamic> homeComTrabalho() => {
      'dashboard': {
        'next': null,
        'counters': {'today': 1, 'overdue': 0, 'inProgress': 0, 'upcoming': 0},
        'today': [
          {
            'id': 'SERVICE_OPERATION:1',
            'kind': 'SERVICE_OPERATION',
            'sourceId': '1',
            'title': 'Atendimento',
            'businessUnit': {'id': 'bu', 'name': 'Matriz'},
            'customer': {'id': 'c1', 'name': 'Condomínio Central'},
            'timezone': 'America/Recife',
            'scheduledFor': '2026-09-01T12:00:00.000Z',
            'dueState': 'DUE_TODAY',
            'operationalStatus': 'SCHEDULED',
            'auxiliaryTechnicians': <dynamic>[],
            'equipmentSummary': <dynamic>[],
            'allowedActions': <String>['VIEW'],
            'navigationContext': {'kind': 'SERVICE_OPERATION', 'sourceId': '1'},
            'updatedAt': '2026-09-01T12:00:00.000Z',
          },
        ],
        'overdue': <dynamic>[],
        'inProgress': <dynamic>[],
        'capabilities': {'canScanEquipment': false, 'canCreateAdHocRvt': false},
      },
      'recentDocuments': <dynamic>[],
      'recentAppointments': <dynamic>[],
    };

    testWidgets('o trabalho continua na tela, com um aviso', (tester) async {
      final adaptador = AdaptadorQueFalhaDepois(homeComTrabalho());
      const environment = OrbitEnvironment(
        apiBaseUrl: urlDeDesenvolvimento,
        flavor: OrbitFlavor.development,
        connectTimeout: Duration(seconds: 15),
        receiveTimeout: Duration(seconds: 30),
      );
      final client = OrbitApiClient.create(
        environment: environment,
        storage: InMemoryTokenStorage(),
        logger: const OrbitLogger(isProduction: false),
        dio: Dio()..httpClientAdapter = adaptador,
        retryDio: Dio()..httpClientAdapter = adaptador,
      );

      final container = ProviderContainer(
        overrides: [
          apiClientProvider.overrideWithValue(client),
          readCacheProvider.overrideWithValue(InMemoryReadCache()),
        ],
      );
      addTearDown(container.dispose);

      await tester.pumpWidget(
        UncontrolledProviderScope(
          container: container,
          child: const MediaQuery(
            data: MediaQueryData(size: Size(390, 800)),
            child: MaterialApp(home: FieldDashboardScreen()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      /// Carregou.
      expect(find.text('Condomínio Central'), findsOneWidget);

      /// A pessoa puxa para atualizar, e a rede cai.
      ///
      /// `pumpAndSettle` espera animação, não `Future`. Sem esperar a leitura
      /// terminar, o teste olharia a tela no instante em que ela ainda está
      /// recarregando — e não veria nem o sucesso nem a falha.
      container.invalidate(fieldHomeProvider);

      /// `pumpAndSettle` espera animação, não `Future`. Alguns quadros dão ao
      /// provider a chance de terminar a leitura e chegar ao estado de erro.
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 50));
      }

      /// O trabalho continua ali.
      expect(
        find.text('Condomínio Central'),
        findsOneWidget,
        reason:
            'O refresh falhou e a tela apagou o dia de trabalho. Quem está em '
            'campo perdeu a fila por causa de um gesto.',
      );

      /// E o aviso apareceu, sem substituir nada.
      expect(find.text('Não foi possível atualizar os dados.'), findsOneWidget);
      expectSafePublicErrorAll(textosVisiveis(tester), onde: 'refresh falho');
    });
  });

  group('as demais telas do dia', () {
    final telas = <String, Widget>{
      'Atendimentos': const WorkQueueScreen(),
      'Agenda': const AgendaScreen(),
      'Documentos': const DocumentsScreen(),
    };

    for (final entrada in telas.entries) {
      testWidgets('${entrada.key} falha em segurança', (tester) async {
        await tester.pumpWidget(host(entrada.value, FalhaDeTransporte.timeout));
        await tester.pumpAndSettle();

        expectSafePublicErrorAll(textosVisiveis(tester), onde: entrada.key);
      });
    }
  });
}

/// Um adaptador que responde bem uma vez e falha depois.
///
/// É o cenário de refresh: a tela carregou, a pessoa puxou para atualizar, e a
/// rede caiu no meio do gesto.
class AdaptadorQueFalhaDepois implements HttpClientAdapter {
  AdaptadorQueFalhaDepois(this.corpo);

  final Map<String, dynamic> corpo;
  int chamadas = 0;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<List<int>>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    chamadas += 1;
    if (chamadas == 1) {
      return ResponseBody.fromString(
        jsonEncode({'success': true, 'data': corpo}),
        200,
        headers: {
          Headers.contentTypeHeader: [Headers.jsonContentType],
        },
      );
    }
    throw DioException.receiveTimeout(
      timeout: const Duration(seconds: 30),
      requestOptions: options,
    );
  }

  @override
  void close({bool force = false}) {}
}
