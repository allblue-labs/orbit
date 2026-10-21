/// As ações da tela de atendimento.
///
/// ## O que está preso aqui
///
/// Que a tela ofereça **duas** decisões — começar, ou avisar que não dá — e não
/// a lista inteira de `allowedActions`. Ela desenhava um botão por ação
/// publicada, e o resultado era uma pilha de botões soltos, parte deles
/// desabilitada, com o único que importava perdido no meio.
///
/// O servidor continua mandando: sem a ação na lista, o botão não existe. O que
/// mudou é que a tela parou de tratar a lista como um menu.
library;

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:orbit_operator/app/providers.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/core/theme/orbit_theme.dart';
import 'package:orbit_operator/features/field/presentation/work_item_detail_screen.dart';

import 'package:orbit_operator/core/contracts/mobile_offline_sync_contracts.dart';
import 'package:orbit_operator/features/sync/application/sync_providers.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';
import 'package:orbit_operator/features/sync/data/journal_file.dart';
import 'package:orbit_operator/features/sync/data/sync_projection.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

void main() {
  /* A tela imprime data e hora em pt-BR; sem isto o `DateFormat` levanta antes
     de qualquer asserção, e a falha não é da tela. */
  setUpAll(() => initializeDateFormatting('pt_BR'));

  /*
   * Superfície alta de propósito.
   *
   * O conteúdo vive num `ListView`, que só constrói o que cabe na viewport — e
   * as ações ficam no fim. Num telefone a pessoa rola até elas; aqui, rolar a
   * cada asserção testaria o `ListView`, não a tela.
   */
  setUp(() {
    final view = TestWidgetsFlutterBinding.instance.platformDispatcher.views
        .first;
    view.physicalSize = const Size(1200, 4000);
    view.devicePixelRatio = 1;
    addTearDown(() {
      view.resetPhysicalSize();
      view.resetDevicePixelRatio();
    });
  });

  testWidgets('oferece iniciar e cancelar, e nada além', (tester) async {
    await tester.pumpWidget(
      _host(acoes: const ['VIEW', 'START', 'ADD_EVIDENCE', 'SCAN_EQUIPMENT',
          'REQUEST_CANCELLATION']),
    );
    await tester.pumpAndSettle();

    expect(find.text('Iniciar o Atendimento'), findsOneWidget);
    expect(find.text('Cancelar o Atendimento'), findsOneWidget);

    /*
     * As que sobraram na lista publicada **não** viram botão aqui: elas têm
     * lugar próprio no roteiro de execução, que é onde fazem sentido. Era essa
     * pilha que a tela despejava.
     */
    expect(find.text('Registrar evidência'), findsNothing);
    expect(find.text('Ler etiqueta'), findsNothing);
    expect(find.text('Abrir'), findsNothing);
  });

  testWidgets('sem a ação publicada, não há botão de cancelar', (tester) async {
    /* O servidor manda. A tela não inventa a ação porque "faria sentido". */
    await tester.pumpWidget(_host(acoes: const ['VIEW', 'START']));
    await tester.pumpAndSettle();

    expect(find.text('Iniciar o Atendimento'), findsOneWidget);
    expect(find.text('Cancelar o Atendimento'), findsNothing);
  });

  testWidgets('continuar troca o rótulo, não o lugar', (tester) async {
    await tester.pumpWidget(
      _host(
        acoes: const ['VIEW', 'RESUME', 'REQUEST_CANCELLATION'],
        emAndamento: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Continuar o Atendimento'), findsOneWidget);
    expect(find.text('Iniciar o Atendimento'), findsNothing);
  });

  testWidgets('iniciar registra o comando antes de abrir o roteiro', (
    tester,
  ) async {
    /*
     * A etapa Preparação trazia um "Iniciar atendimento" próprio: quem tocava
     * aqui caía numa etapa pedindo a mesma coisa de novo. O comando passou a
     * sair daqui, que é onde a decisão é tomada.
     *
     * A asserção é sobre o **diário**, e não sobre HTTP: o comando entra na
     * fila offline e sai de lá quando houver rede. Cobrar a requisição
     * testaria o sincronizador, não a tela.
     */
    final diario = CommandJournal(file: MemoryJournalFile());
    await tester.pumpWidget(_host(diario: diario));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Iniciar o Atendimento'));
    await tester.pumpAndSettle();

    final registrados = (await diario.read()).commands;
    expect(
      registrados.map((c) => c.envelope.commandType.name),
      contains(OfflineCommandType.operationStart.name),
    );
  });

  testWidgets('atendimento em andamento não reenvia o início', (tester) async {
    /* "Continuar" entra direto: reenviar o início de algo já começado seria um
       comando sem efeito, e a tela prometeria uma transição que não há. */
    final diario = CommandJournal(file: MemoryJournalFile());
    await tester.pumpWidget(
      _host(
        acoes: const ['VIEW', 'RESUME', 'REQUEST_CANCELLATION'],
        emAndamento: true,
        diario: diario,
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Continuar o Atendimento'));
    await tester.pumpAndSettle();

    expect((await diario.read()).commands, isEmpty);
  });

  testWidgets('pedido já enviado ocupa o lugar do botão', (tester) async {
    /*
     * A asserção que evita o pedido em duplicata. Sem ela o técnico tocaria de
     * novo a cada vez que abrisse o atendimento, sem sinal de que o primeiro
     * chegou — e o servidor devolveria o mesmo pedido em silêncio.
     */
    await tester.pumpWidget(
      _host(
        acoes: const ['VIEW', 'START', 'REQUEST_CANCELLATION'],
        pedidoPendente: true,
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Cancelar o Atendimento'), findsNothing);
    expect(find.text('CANCELAMENTO PEDIDO'), findsOneWidget);
    expect(find.textContaining('Portão trancado'), findsOneWidget);

    /*
     * E a situação passa a dizê-lo.
     *
     * A do domínio não muda ao pedir — quem decide é o responsável, e o
     * compromisso segue de pé. Mas a etiqueta dizendo só "Programado" fazia o
     * pedido parecer que não tinha acontecido.
     */
    expect(find.text('Aguardando cancelamento'), findsOneWidget);

    /* Iniciar continua: o atendimento segue de pé até o responsável decidir. */
    expect(find.text('Iniciar o Atendimento'), findsOneWidget);
  });

  testWidgets('mostra o endereço com complemento e ponto de referência', (
    tester,
  ) async {
    /* O que fazia o técnico ligar para o escritório: os dois campos que
       decidem se ele acha a portaria. */
    await tester.pumpWidget(_host());
    await tester.pumpAndSettle();

    expect(find.text('Bloco B, 4º andar'), findsOneWidget);
    expect(find.textContaining('Portão azul nos fundos'), findsOneWidget);

    /* Contato e telefone saem na mesma linha: são a mesma informação — para
       quem ligar —, e duas linhas rotuladas separavam o nome do número. */
    expect(find.textContaining('+55 81 98888-0000'), findsOneWidget);

    /* O tipo subiu para a sobrancelha do cartão, junto da natureza do item:
       é contexto do título, não um campo a consultar. */
    expect(find.textContaining('MANUTENÇÃO'), findsOneWidget);
  });

  /// O que o cadastro incompleto mostra.
  ///
  /// Esconder campo vazio dizia duas coisas com o mesmo silêncio: "não há
  /// complemento" e "ninguém cadastrou" ficavam idênticos. Quem chega na
  /// portaria precisa saber em qual dos dois está — no primeiro procura a
  /// porta, no segundo liga.
  testWidgets('endereço sem complemento e sem referência diz que faltam', (
    tester,
  ) async {
    await tester.pumpWidget(_host(enderecoIncompleto: true));
    await tester.pumpAndSettle();

    expect(find.text('Complemento não informado'), findsOneWidget);
    expect(find.text('Ponto de referência não informado'), findsOneWidget);
    expect(find.text('Local no endereço não informado'), findsOneWidget);

    /* O que existe continua aparecendo como valor, não como ausência. */
    expect(find.textContaining('Av. Agamenon Magalhães'), findsOneWidget);
  });

  testWidgets('cliente sem contato diz que falta', (tester) async {
    /* O caso mais caro de esconder: quem não sabe que não há telefone planeja
       avisar que está chegando, e descobre na portaria. */
    await tester.pumpWidget(_host(semContato: true));
    await tester.pumpAndSettle();

    expect(find.text('Contato não informado'), findsOneWidget);
  });

  testWidgets('com cadastro completo, nenhuma ausência é anunciada', (
    tester,
  ) async {
    await tester.pumpWidget(_host());
    await tester.pumpAndSettle();

    expect(find.textContaining('não informado'), findsNothing);
  });

  testWidgets('sem liberação, o valor não aparece', (tester) async {
    /*
     * Ausência, e não "R$ 0,00": o servidor omite `financialSummary` quando o
     * responsável não liberou aquele atendimento, e omitir é a única forma de
     * não afirmar nada sobre o valor.
     */
    await tester.pumpWidget(_host(comValor: false));
    await tester.pumpAndSettle();

    expect(find.text('VALOR DO ATENDIMENTO'), findsNothing);
  });

  testWidgets('liberado, o valor aparece', (tester) async {
    await tester.pumpWidget(_host(comValor: true));
    await tester.pumpAndSettle();

    expect(find.text('VALOR DO ATENDIMENTO'), findsOneWidget);
    expect(find.textContaining('8.450'), findsOneWidget);
  });

  testWidgets('liberado e sem orçamento diz o que falta vincular', (
    tester,
  ) async {
    /* O estado que fazia o dono ligar a chave, não ver nada e achar que a
       liberação não funcionava. */
    await tester.pumpWidget(_host(comValor: true, semOrcamento: true));
    await tester.pumpAndSettle();

    expect(find.text('VALOR DO ATENDIMENTO'), findsOneWidget);
    expect(find.text('Valor do atendimento não informado'), findsOneWidget);
  });
}

Widget _host({
  List<String> acoes = const ['VIEW', 'START', 'REQUEST_CANCELLATION'],
  bool pedidoPendente = false,
  bool comValor = false,
  /// Liberado para o campo, mas sem orçamento vinculado.
  bool semOrcamento = false,
  /// Endereço cadastrado sem complemento nem ponto de referência — o estado
  /// real de um cliente recém-cadastrado.
  bool enderecoIncompleto = false,
  /// Cliente sem contato nenhum.
  bool semContato = false,
  /// O atendimento já começou — o botão vira "Continuar" e não reenvia início.
  bool emAndamento = false,
  /// O diário de comandos, quando o teste quer inspecioná-lo.
  CommandJournal? diario,
}) {
  Future<ResponseBody> handler(RequestOptions options) async {
    /// A preparação da execução.
    ///
    /// A tela de detalhe passou a observá-la: é dela que sai a versão do
    /// atendimento, sem a qual o comando de início seria um no-op silencioso.
    if (options.uri.path.endsWith('/execution-preparation')) {
      return jsonResponse({
        'success': true,
        'data': {
          'operation': {
            'id': 'op-1',
            'code': 'OS-1',
            'status': emAndamento ? 'IN_PROGRESS' : 'SCHEDULED',
          },
          'executionEligibility': {'eligible': true, 'blockers': <String>[]},
          'equipment': <Map<String, dynamic>>[],
          'auxiliaryTechnicians': <Map<String, dynamic>>[],
          'checklist': <Map<String, dynamic>>[],
          'materialPolicy': {'enabled': false},
          'allowedActions': emAndamento
              ? ['COMPLETE', 'ADD_NOTE']
              : ['START'],
          'primaryAction': emAndamento ? 'COMPLETE' : 'START',
          'version': 'v1',
        },
      });
    }

    if (options.uri.path.contains('/work-items/')) {
      return jsonResponse({
        'success': true,
        'data': {
          'workItem': {
            'id': 'SERVICE_OPERATION:op-1',
            'kind': 'SERVICE_OPERATION',
            'sourceId': 'op-1',
            'title': 'Manutenção preventiva — Chiller 40TR',
            'businessUnit': {'id': 'bu', 'name': 'Matriz'},
            'customer': {
              'id': 'c1',
              'name': 'Shopping Recife',
              'contact': semContato
                  ? null
                  : {
                      'name': 'Dona Rita',
                      'phone': '+55 81 98888-0000',
                      'email': null,
                    },
            },
            'serviceAddress': {
              'label': 'Matriz',
              'street': 'Av. Agamenon Magalhães',
              'number': '1200',
              'complement': enderecoIncompleto ? null : 'Bloco B, 4º andar',
              'district': 'Boa Vista',
              'city': 'Recife',
              'stateCode': 'PE',
              'postalCode': '50050-000',
              'reference': enderecoIncompleto
                  ? null
                  : 'Portão azul nos fundos; falar com a portaria.',
              'sector': enderecoIncompleto ? null : 'Casa de máquinas',
            },
            'serviceType': 'Manutenção',
            'pendingCancellation': pedidoPendente
                ? {
                    'id': 'req-1',
                    'reason': 'Portão trancado e ninguém atende.',
                    'requestedAt': '2026-09-08T12:00:00.000Z',
                  }
                : null,
            'timezone': 'America/Recife',
            'scheduledFor': '2026-09-08T12:30:00.000Z',
            'dueState': 'DUE_TODAY',
            'operationalStatus': 'SCHEDULED',
            'auxiliaryTechnicians': const <Map<String, dynamic>>[],
            'equipmentSummary': const <Map<String, dynamic>>[],
            'allowedActions': acoes,
            'navigationContext': {
              'kind': 'SERVICE_OPERATION',
              'sourceId': 'op-1',
            },
            'updatedAt': '2026-09-08T10:00:00.000Z',
          },
          'request': {'description': null},
          'procedures': const <Map<String, dynamic>>[],
          'documentContext': const <Map<String, dynamic>>[],
          if (comValor)
            'financialSummary': {
              'currency': 'BRL',
              'approvedAmount': semOrcamento ? null : '8450.00',
              'paymentStatus': semOrcamento ? null : 'APPROVED',
            },
          'snapshotVersion': 3,
        },
      });
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
      /* O repositório de campo guarda a leitura em disco; sem um cache de
         memória o teste tropeça no canal de plataforma, não na tela. */
      readCacheProvider.overrideWithValue(InMemoryReadCache()),
      /* O controlador de execução grava intenções antes de enviá-las; sem um
         diário em memória o teste tropeça no armazenamento do aparelho. */
      commandJournalProvider.overrideWithValue(
        diario ?? CommandJournal(file: MemoryJournalFile()),
      ),
      syncProjectionProvider.overrideWithValue(
        SyncProjectionStore(file: MemoryJournalFile()),
      ),
    ],
    /// Com roteador de verdade: iniciar **navega** depois de enviar o
    /// comando, e sem um `GoRouter` no contexto o `push` levanta antes de a
    /// asserção acontecer.
    child: MaterialApp.router(
      theme: OrbitTheme.light(),
      routerConfig: GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, __) => const WorkItemDetailScreen(
              workItemId: 'SERVICE_OPERATION:op-1',
            ),
            routes: [
              GoRoute(
                path: 'execucao/:id',
                builder: (_, __) => const Scaffold(body: Text('roteiro')),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
