/// O atendimento de PMOC no celular, contra um backend scriptado.
///
/// ## O que este teste protege
///
/// Duas coisas que quebram calado. A primeira é **qual porta** o aplicativo bate:
/// as rotas sem `mine` exigem `pmoc.manage`, que o papel de campo não tem — se um
/// caminho voltar para elas, o técnico recebe 403 e nada nos testes de widget
/// percebe. A segunda é **de onde vem o passo**: `allowedActions` é do servidor, e
/// no dia em que a tela começar a deduzir do `status` a máquina de estados passa a
/// existir em dois lugares.
///
/// A releitura depois de cada comando faz parte do contrato: é ela que traz a
/// ação seguinte. Um comando que não relê deixa a tela afirmando um estado que só
/// a resposta pode confirmar.
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/pmoc/application/pmoc_attendance_controller.dart';
import 'package:orbit_operator/features/pmoc/data/pmoc_repository.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

const plano = 'plan-1';
const ciclo = 'cycle-1';
const equipamento = 'asset-1';
const execucaoId = 'exec-1';

Map<String, Object?> execucaoJson({
  String status = 'IN_PROGRESS',
  int sequenceNumber = 3,
  Map<String, Object?>? artifactExecution,
  String? notes,
}) => {
  'id': execucaoId,
  'status': status,
  'sequenceNumber': sequenceNumber,
  'startedAt': '2026-09-29T12:00:00.000Z',
  'completedAt': status == 'COMPLETED' ? '2026-09-29T13:00:00.000Z' : null,
  'performedAt': status == 'COMPLETED' ? '2026-09-29T13:00:00.000Z' : null,
  'notes': notes,
  'asset': {'id': equipamento, 'name': 'Split 12.000'},
  'responsibleFieldTechnician': {'id': 'user-1', 'displayName': 'Ana'},
  'auxiliaryTechnicians': <Map<String, Object?>>[],
  'evidence': <Map<String, Object?>>[],
  'operation': null,
  'artifactExecution': artifactExecution,
};

Map<String, Object?> preparacaoJson({
  List<String> actions = const ['START'],
  bool ready = true,
  List<String> blocked = const [],
  Map<String, Object?>? existing,
}) => {
  'plan': {'id': plano, 'code': 'PMOC-CLIENTE-01', 'name': 'PMOC Matriz'},
  'cycle': {'id': ciclo, 'sequenceNumber': 7, 'status': 'PENDING', 'dueOn': '2026-10-31'},
  'customer': {'id': 'cust-1', 'name': 'Clínica São José'},
  'equipment': {'id': equipamento, 'name': 'Split 12.000'},
  'serviceLocation': 'Casa de máquinas',
  'technicalResponsible': {'id': 'rt-1', 'displayName': 'Marcos'},
  'procedure': {'Evaporadora': ['Limpar filtros de ar']},
  'procedureGroups': [
    {'group': 'Evaporadora', 'items': ['Limpar filtros de ar']},
  ],
  'eligibility': {'ready': ready, 'blockedReasons': blocked},
  'existingExecution': existing,
  'allowedActions': actions,
};

/// Um backend controlado pelo teste, que registra os caminhos que recebeu.
class Backend {
  Backend({Map<String, Object?>? preparation})
    : preparation = preparation ?? preparacaoJson();

  Map<String, Object?> preparation;

  final preparations = <String>[];
  final starts = <String>[];
  final completes = <String>[];
  final completeBodies = <Map<String, dynamic>>[];
  final generates = <String>[];
  final manifestLists = <String>[];
  final manifestDownloads = <String>[];

  /// `true` quando o próximo comando deve falhar — a recusa de atribuição do
  /// servidor, que é como o técnico sem escala descobre a regra.
  int refuseStatus = 0;

  Future<ResponseBody> call(RequestOptions options) async {
    final path = options.uri.path;

    if (path.endsWith('/execution-preparation')) {
      preparations.add(path);
      return jsonResponse({'success': true, 'data': preparation});
    }

    if (refuseStatus != 0) {
      final status = refuseStatus;
      refuseStatus = 0;
      return jsonResponse({
        'success': false,
        'message': 'Este PMOC não está atribuído a você.',
      }, status: status);
    }

    if (path.endsWith('/executions/mine')) {
      starts.add(path);
      final execucao = execucaoJson();
      preparation = preparacaoJson(
        actions: const ['COMPLETE', 'ADD_EVIDENCE'],
        existing: execucao,
      );
      return jsonResponse({'success': true, 'data': {'execution': execucao}});
    }

    if (path.endsWith('/complete/mine')) {
      completes.add(path);
      completeBodies.add(
        options.data is String
            ? jsonDecode(options.data as String) as Map<String, dynamic>
            : (options.data as Map<String, dynamic>?) ?? const {},
      );
      final execucao = execucaoJson(status: 'COMPLETED', notes: 'Filtros lavados');
      preparation = preparacaoJson(
        actions: const ['VIEW'],
        existing: execucao,
      );
      return jsonResponse({
        'success': true,
        'data': {'execution': execucao, 'cycleCompleted': true},
      });
    }

    if (path.endsWith('/artifact/generate/mine')) {
      generates.add(path);
      final execucao = execucaoJson(
        status: 'COMPLETED',
        artifactExecution: {'id': 'art-1', 'code': 'PMOC-1', 'status': 'COMPLETED'},
      );
      preparation = preparacaoJson(actions: const ['VIEW'], existing: execucao);
      return jsonResponse({
        'success': true,
        'data': {
          'artifactExecutionId': 'art-1',
          'created': true,
          'sourceType': 'PMOC_EQUIPMENT_EXECUTION',
          'sourceEntityId': execucaoId,
        },
      });
    }

    if (path.endsWith('/manifests')) {
      manifestLists.add(path);
      return jsonResponse({
        'success': true,
        'data': {
          'data': [
            {
              'id': 'manifest-1',
              'revision': 1,
              'status': 'ISSUED',
              'format': 'PDF',
              'isActive': true,
              'issuedAt': '2026-09-29T13:10:00.000Z',
            },
          ],
          'meta': {'total': 1, 'activeRevision': 1},
        },
      });
    }

    if (path.endsWith('/download')) {
      manifestDownloads.add(options.uri.toString());
      return jsonResponse({
        'success': true,
        'data': {
          'url': 'https://storage.example/pmoc.pdf?sig=abc',
          'method': 'GET',
          'expiresAt': '2099-01-01T00:00:00.000Z',
          'requiredHeaders': const <String, Object?>{},
        },
      });
    }

    return ResponseBody.fromString('{}', 404);
  }
}

PmocAttendanceController build(Backend backend) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );
  return PmocAttendanceController(
    repository: PmocRepository(client: client),
    target: const PmocAttendanceTarget(
      planId: plano,
      cycleId: ciclo,
      assetId: equipamento,
    ),
  );
}

Future<void> settle(PmocAttendanceController controller) async {
  for (var i = 0; i < 40 && controller.state.phase != PmocAttendancePhase.ready; i += 1) {
    await Future<void>.delayed(Duration.zero);
  }
}

PmocRepository buildRepository(Backend backend) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  return PmocRepository(
    client: OrbitApiClient.create(
      environment: OrbitEnvironment.fromDefines(),
      storage: InMemoryTokenStorage(),
      logger: const OrbitLogger(isProduction: true),
      dio: dio,
      retryDio: plain,
    ),
  );
}

void main() {
  group('abrir a tela', () {
    test('lê a preparação e não abre nada', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      expect(backend.preparations, hasLength(1));

      /// Abrir a tela é leitura. Iniciar a execução é ato do técnico, e reserva a
      /// contagem daquele equipamento — não pode acontecer por navegação.
      expect(backend.starts, isEmpty);
      expect(controller.state.execution, isNull);
      expect(controller.state.allows('START'), isTrue);
      controller.dispose();
    });

    test('sem ação publicada, nada é permitido', () async {
      final backend = Backend(
        preparation: preparacaoJson(
          actions: const [],
          ready: false,
          blocked: const ['TECHNICAL_RESPONSIBLE_MISSING'],
        ),
      );
      final controller = build(backend);
      await settle(controller);

      expect(controller.state.allows('START'), isFalse);
      expect(controller.state.preparation?.eligibility.blockedReasons, [
        'TECHNICAL_RESPONSIBLE_MISSING',
      ]);
      controller.dispose();
    });
  });

  group('abrir o atendimento', () {
    test('bate na porta de quem executa, não na de quem gerencia', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      await controller.start();

      /// `executions/mine` exige `pmoc.execute`; `executions` exige
      /// `pmoc.manage`, que o papel de campo não tem. Trocar uma pela outra dá
      /// 403 para todo técnico.
      expect(backend.starts.single, endsWith('/executions/mine'));
      controller.dispose();
    });

    test('o passo seguinte vem da releitura, não do toque', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      await controller.start();

      /// Duas preparações: a da abertura da tela e a de depois do comando. É a
      /// segunda que traz `COMPLETE` — avançar localmente afirmaria um estado que
      /// só a resposta confirma.
      expect(backend.preparations, hasLength(2));
      expect(controller.state.allows('COMPLETE'), isTrue);
      expect(controller.state.execution?.sequenceNumber, 3);
      controller.dispose();
    });

    test('a recusa do servidor fica na tela e o estado não avança', () async {
      final backend = Backend()..refuseStatus = 403;
      final controller = build(backend);
      await settle(controller);

      await controller.start();

      expect(controller.state.error, isNotNull);

      /// Continua oferecendo abrir: a recusa foi de autoridade, não de estado — e
      /// esconder o botão faria parecer que o atendimento começou.
      expect(controller.state.allows('START'), isTrue);
      expect(controller.state.execution, isNull);
      controller.dispose();
    });
  });

  group('concluir', () {
    test('usa a porta de execução e manda só o que foi preenchido', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);
      await controller.start();

      await controller.complete(notes: '  Filtros lavados  ');

      expect(backend.completes.single, endsWith('/complete/mine'));

      /// Sem `performedAt`: em branco significa **agora**, e o agora é o do
      /// servidor — o relógio do aparelho pode estar errado, e a hora da
      /// manutenção é registro legal.
      expect(backend.completeBodies.single.containsKey('performedAt'), isFalse);
      expect(backend.completeBodies.single['notes'], 'Filtros lavados');
      controller.dispose();
    });

    test('o fechamento do ciclo é o que o servidor disse', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);
      await controller.start();

      await controller.complete();

      /// Contar equipamentos resolvidos no aparelho daria a resposta errada assim
      /// que outra pessoa atendesse um do mesmo ciclo em paralelo.
      expect(controller.state.cycleCompleted, isTrue);
      controller.dispose();
    });

    test('sem execução aberta não envia nada', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      await controller.complete(notes: 'seria um registro sem dono');

      expect(backend.completes, isEmpty);
      controller.dispose();
    });
  });

  group('emitir o relatório', () {
    test('é decisão separada de concluir', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);
      await controller.start();
      await controller.complete();

      /// Concluir não emitiu: a manutenção aconteceu e o documento é outro ato.
      expect(backend.generates, isEmpty);
      expect(controller.state.isFinished, isFalse);

      await controller.issueReport();

      expect(backend.generates.single, endsWith('/artifact/generate/mine'));

      /// Terminado é concluído **com** documento: sem ele o trabalho existe e a
      /// prova de conformidade não.
      expect(controller.state.isFinished, isTrue);
      controller.dispose();
    });
  });

  group('um comando por vez', () {
    test('o segundo toque não vira um segundo pedido', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      /// Sem esperar o primeiro: é o toque duplo de quem está de luva.
      await Future.wait([controller.start(), controller.start()]);

      expect(backend.starts, hasLength(1));
      controller.dispose();
    });
  });

  /// O arquivo do relatório não vem do fluxo documental de campo.
  ///
  /// Aquele congela um artefato próprio, e recusa PMOC de propósito — o snapshot
  /// premium é do módulo de PMOC. O PDF mora na **revisão** da execução de
  /// artefato, e é de lá que o celular o busca; apontar para a rota errada faria a
  /// tela dizer "sendo gerado" para sempre.
  group('o arquivo do relatório', () {
    test('sai das revisões da execução de artefato', () async {
      final backend = Backend();
      final repository = buildRepository(backend);

      final revisoes = await repository.documentRevisions('art-1');

      expect(
        backend.manifestLists.single,
        endsWith('/artifact-executions/art-1/manifests'),
      );
      expect(revisoes.single.isDownloadable, isTrue);
    });

    test('a URL é assinada por revisão, e pedida para baixar', () async {
      final backend = Backend();
      final repository = buildRepository(backend);

      final acesso = await repository.documentAccess('manifest-1');

      expect(
        backend.manifestDownloads.single,
        contains('/artifact-manifests/manifest-1/download'),
      );

      /// `download`, não `preview`: o servidor distingue os dois na assinatura, e
      /// em campo o arquivo vai para a folha do sistema — é para entregar.
      expect(backend.manifestDownloads.single, contains('operation=download'));
      expect(acesso.url.host, 'storage.example');
    });
  });
}
