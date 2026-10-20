/// O ciclo do documento contra um backend scriptado.
library;

import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';
import 'package:orbit_operator/core/contracts/mobile_field_artifact_contracts.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/core/observability/orbit_logger.dart';
import 'package:orbit_operator/features/artifact/application/artifact_controller.dart';
import 'package:orbit_operator/features/artifact/data/artifact_repository.dart';
import 'package:orbit_operator/features/artifact/data/document_file.dart';

import '../support/fakes.dart';
import '../support/scripted_adapter.dart';

final pdf = utf8.encode('%PDF-1.7 documento de verdade');

Map<String, Object?> artifactJson({
  String status = 'PREPARED',
  List<String> actions = const ['GENERATE_DOCUMENT'],
  String? generatedAt,
}) => {
  'id': 'art-1',
  'artifactExecutionId': 'exec-1',
  'sourceType': 'OPERATION',
  'sourceId': 'op-1',
  'documentType': 'SERVICE_ORDER',
  'status': status,
  'snapshotVersion': 1,
  'snapshotHash': 'a' * 64,
  'templateVersion': 3,
  'generatedAt': generatedAt,
  'previewAvailable': status == 'READY',
  'downloadAvailable': status == 'READY',
  'allowedActions': actions,
};

Map<String, Object?> preparationJson({
  bool eligible = true,
  List<String> blocked = const [],
  List<String> actions = const ['PREPARE_DOCUMENT'],
  Map<String, Object?>? existing,
}) => {
  'sourceType': 'OPERATION',
  'sourceId': 'op-1',
  'documentType': 'SERVICE_ORDER',
  'eligibility': {'eligible': eligible, 'blockedReasons': blocked},
  'templateVersion': 3,
  'professionalSignatures': {
    'fieldTechnician': true,
    'technicalResponsibleRequired': false,
    'technicalResponsible': false,
  },
  'customerAcknowledgement': {
    'required': false,
    'available': false,
    'valid': true,
  },
  'evidenceSummary': {'finalized': 2, 'pending': 0},
  'snapshotVersion': 1,
  'existingArtifact': existing,
  'allowedActions': actions,
};

/// Um backend controlado pelo teste, que registra o que recebeu.
class Backend {
  Backend({
    Map<String, Object?>? preparation,
    this.artifact,
    this.downloadStatus = 200,
    this.downloadBody,
    this.downloadContentType = 'application/pdf',
  }) : preparation = preparation ?? preparationJson();

  Map<String, Object?> preparation;
  Map<String, Object?>? artifact;

  /// O congelamento recusado pelo servidor — um atendimento que mudou entre a
  /// leitura da tela e o pedido.
  bool failPrepare = false;
  int downloadStatus;
  List<int>? downloadBody;
  String downloadContentType;

  final preparations = <String>[];
  final prepares = <Map<String, dynamic>>[];
  final renders = <String>[];
  final gets = <String>[];
  final accesses = <String>[];
  final downloads = <RequestOptions>[];

  Future<ResponseBody> call(RequestOptions options) async {
    final path = options.uri.path;

    if (options.uri.host == 'storage.example') {
      downloads.add(options);
      if (downloadStatus != 200) {
        return ResponseBody.fromString('', downloadStatus);
      }
      return ResponseBody.fromBytes(
        downloadBody ?? pdf,
        200,
        headers: {
          Headers.contentTypeHeader: [downloadContentType],
        },
      );
    }
    if (path.endsWith('/preparation')) {
      preparations.add(path);
      return jsonResponse({'success': true, 'data': preparation});
    }
    if (path.endsWith('/prepare')) {
      if (failPrepare) return ResponseBody.fromString('{}', 409);
      prepares.add(
        options.data is String
            ? jsonDecode(options.data as String) as Map<String, dynamic>
            : options.data as Map<String, dynamic>,
      );
      artifact ??= artifactJson();
      preparation = preparationJson(
        actions: const ['GENERATE_DOCUMENT'],
        existing: artifact,
      );
      return jsonResponse({'success': true, 'data': artifact!});
    }
    if (path.endsWith('/render')) {
      renders.add(path);
      artifact = artifactJson(status: 'PENDING', actions: const []);
      preparation = preparationJson(actions: const [], existing: artifact);
      return jsonResponse({'success': true, 'data': artifact!});
    }
    if (path.endsWith('/access')) {
      accesses.add(options.uri.query);
      return jsonResponse({
        'success': true,
        'data': {
          'artifactId': 'art-1',
          'operation': options.uri.queryParameters['operation'] ?? 'download',
          'url': 'https://storage.example/doc.pdf?sig=abc',
          'expiresAt': '2099-01-01T00:00:00.000Z',
          'requiredHeaders': const <String, Object?>{},
        },
      });
    }
    if (path.contains('/artifacts/')) {
      gets.add(path);
      return jsonResponse({'success': true, 'data': artifact!});
    }
    return ResponseBody.fromString('{}', 404);
  }
}

ArtifactController build(Backend backend, {MemoryDocumentFileStore? files}) {
  final dio = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final plain = Dio()..httpClientAdapter = ScriptedAdapter(backend.call);
  final client = OrbitApiClient.create(
    environment: OrbitEnvironment.fromDefines(),
    storage: InMemoryTokenStorage(),
    logger: const OrbitLogger(isProduction: true),
    dio: dio,
    retryDio: plain,
  );
  return ArtifactController(
    repository: ArtifactRepository(client: client),
    files: files ?? MemoryDocumentFileStore(),
    sourceType: FieldArtifactSourceType.operation,
    sourceId: 'op-1',
  );
}

/// Espera o carregamento inicial, que o construtor dispara.
Future<void> settle(ArtifactController controller) async {
  for (var i = 0; i < 20 && controller.state.loading; i += 1) {
    await Future<void>.delayed(Duration.zero);
  }
}

void main() {
  group('abrir a seção', () {
    test('consulta a preparação e não congela nada', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      expect(backend.preparations, hasLength(1));

      /// Congelar snapshot é irreversível: abrir a tela não pode fazê-lo.
      expect(backend.prepares, isEmpty);
      expect(backend.renders, isEmpty);
      expect(controller.state.artifact, isNull);
      controller.dispose();
    });

    test('bloqueios do servidor chegam sem recálculo', () async {
      final backend = Backend(
        preparation: preparationJson(
          eligible: false,
          blocked: const ['FIELD_TECHNICIAN_SIGNATURE_MISSING'],
          actions: const [],
        ),
      );
      final controller = build(backend);
      await settle(controller);

      expect(controller.state.blockedReasons, [
        FieldArtifactBlockedReason.fieldTechnicianSignatureMissing,
      ]);

      /// Sem ação publicada, não há ação oferecida.
      expect(
        controller.state.allows(FieldArtifactAllowedAction.prepareDocument),
        isFalse,
      );
      controller.dispose();
    });
  });

  group('preparar e emitir', () {
    test('preparar congela e as ações passam a vir do artefato', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      await controller.prepare();

      expect(backend.prepares.single['sourceType'], 'OPERATION');
      expect(controller.state.artifact?.id, 'art-1');
      expect(
        controller.state.allows(FieldArtifactAllowedAction.generateDocument),
        isTrue,
      );
      controller.dispose();
    });

    test('sem ação publicada, preparar não faz nada', () async {
      final backend = Backend(
        preparation: preparationJson(
          eligible: false,
          blocked: const ['SOURCE_NOT_COMPLETED'],
          actions: const [],
        ),
      );
      final controller = build(backend);
      await settle(controller);

      await controller.prepare();
      expect(backend.prepares, isEmpty);
      controller.dispose();
    });

    test('dois toques não viram dois documentos', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      /// O segundo toque encontra o comando em voo e é ignorado; o servidor
      /// ainda garante idempotência, mas o app não conta com isso para
      /// evitar o próprio toque duplo.
      await Future.wait([controller.prepare(), controller.prepare()]);
      expect(backend.prepares, hasLength(1));
      controller.dispose();
    });

    test('emitir aceita o pedido — e não afirma que o PDF existe', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);
      await controller.prepare();

      await controller.render();

      expect(backend.renders, hasLength(1));

      /// Pedido aceito, documento em processamento. Não disponível.
      expect(controller.state.status, FieldArtifactStatus.pending);
      expect(
        controller.state.allows(FieldArtifactAllowedAction.downloadDocument),
        isFalse,
      );
      controller.dispose();
    });
  });

  group('acompanhamento', () {
    test('atualizar manualmente relê o estado autoritativo', () async {
      final backend = Backend(
        preparation: preparationJson(
          actions: const ['GENERATE_DOCUMENT'],
          existing: artifactJson(status: 'PENDING', actions: const []),
        ),
      );
      final controller = build(backend);
      await settle(controller);
      expect(controller.state.status, FieldArtifactStatus.pending);

      /// O documento ficou pronto no servidor.
      backend.preparation = preparationJson(
        actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
        existing: artifactJson(
          status: 'READY',
          actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
          generatedAt: '2026-09-02T10:00:00.000Z',
        ),
      );
      await controller.refresh();

      expect(controller.state.status, FieldArtifactStatus.ready);
      expect(controller.state.artifact?.generatedAt, isNotNull);
      controller.dispose();
    });

    test('sair da tela para de perguntar', () async {
      final backend = Backend(
        preparation: preparationJson(
          existing: artifactJson(status: 'RENDERING', actions: const []),
        ),
      );
      final controller = build(backend);
      await settle(controller);
      expect(controller.state.isTransient, isTrue);

      controller.dispose();
      final before = backend.gets.length;

      /// Passado o intervalo, nada mais é consultado: não há acompanhamento
      /// em segundo plano.
      await Future<void>.delayed(const Duration(seconds: 4));
      expect(backend.gets.length, before);
    });
  });

  /// Emitir, num toque.
  ///
  /// Congelar e renderizar são dois pedidos ao servidor e continuam sendo. O que
  /// mudou é a tela: com os dois expostos, o técnico congelava, achava que tinha
  /// acabado e o atendimento ficava parado em "pronto para emitir" — o cliente sem
  /// documento e ninguém sabendo por quê.
  group('emitir', () {
    test('congela e manda renderizar na sequência', () async {
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      await controller.issue();

      expect(backend.prepares, hasLength(1));
      expect(backend.renders, hasLength(1));
      controller.dispose();
    });

    test('artefato já congelado só é renderizado', () async {
      /// Repetir o congelamento seria pedir um segundo snapshot da mesma fonte —
      /// idempotente no servidor, mas uma ida à rede que a tela já sabe evitar.
      final backend = Backend(
        artifact: artifactJson(actions: const ['GENERATE_DOCUMENT']),
        preparation: preparationJson(
          actions: const ['GENERATE_DOCUMENT'],
          existing: artifactJson(actions: const ['GENERATE_DOCUMENT']),
        ),
      );
      final controller = build(backend);
      await settle(controller);

      await controller.issue();

      expect(backend.prepares, isEmpty);
      expect(backend.renders, hasLength(1));
      controller.dispose();
    });

    test('falha ao congelar não vira pedido de renderização', () async {
      /// Renderizar um artefato que não existe daria um segundo erro em cima do
      /// primeiro, e a pessoa leria o errado. Quem recusa é o próprio `render` —
      /// sem artefato e sem ação publicada, ele não vai à rede.
      final backend = Backend()..failPrepare = true;
      final controller = build(backend);
      await settle(controller);

      await controller.issue();

      expect(backend.renders, isEmpty);
      expect(controller.state.error, isNotNull);
      controller.dispose();
    });

    test('dois toques não viram dois documentos', () async {
      /// O toque duplo de quem está de luva. O guarda de comando em voo é de cada
      /// comando, e é ele que faz a composição ser segura.
      final backend = Backend();
      final controller = build(backend);
      await settle(controller);

      await Future.wait([controller.issue(), controller.issue()]);

      expect(backend.prepares, hasLength(1));
      controller.dispose();
    });

    test('sem ação publicada, não emite', () async {
      final backend = Backend(
        preparation: preparationJson(
          eligible: false,
          blocked: const ['SOURCE_NOT_COMPLETED'],
          actions: const [],
        ),
      );
      final controller = build(backend);
      await settle(controller);

      await controller.issue();

      expect(backend.prepares, isEmpty);
      expect(backend.renders, isEmpty);
      controller.dispose();
    });
  });

  group('download', () {
    test('pede a URL na hora, baixa e verifica', () async {
      final files = MemoryDocumentFileStore();
      final backend = Backend(
        preparation: preparationJson(
          actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
          existing: artifactJson(
            status: 'READY',
            actions: const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
          ),
        ),
      );
      final controller = build(backend, files: files);
      await settle(controller);

      await controller.download();

      expect(backend.accesses, hasLength(1));
      expect(controller.state.download.phase, DownloadPhase.availableLocally);
      expect(files.files, hasLength(1));

      /// O arquivo tem nome legível, não o identificador do artefato.
      expect(files.files.keys.single, contains('.pdf'));
      expect(files.files.keys.single, isNot(contains('art-1')));
      controller.dispose();
    });

    test('o download vai sem o token da sessão', () async {
      final backend = Backend(
        preparation: preparationJson(
          actions: const ['DOWNLOAD_DOCUMENT'],
          existing: artifactJson(
            status: 'READY',
            actions: const ['DOWNLOAD_DOCUMENT'],
          ),
        ),
      );
      final controller = build(backend);
      await settle(controller);
      await controller.download();

      /// A assinatura da URL é a credencial; mandar o `Bearer` para o storage
      /// seria vazá-lo para fora da API.
      expect(
        backend.downloads.single.headers.containsKey('Authorization'),
        isFalse,
      );
      controller.dispose();
    });

    test('conteúdo que não é PDF não vira documento', () async {
      final files = MemoryDocumentFileStore();
      final backend = Backend(
        preparation: preparationJson(
          actions: const ['DOWNLOAD_DOCUMENT'],
          existing: artifactJson(
            status: 'READY',
            actions: const ['DOWNLOAD_DOCUMENT'],
          ),
        ),
        downloadBody: utf8.encode('<html>Erro do proxy</html>'),
      );
      final controller = build(backend, files: files);
      await settle(controller);
      await controller.download();

      expect(controller.state.download.phase, DownloadPhase.error);

      /// E nada é gravado: abrir uma página de erro como se fosse o documento
      /// do cliente é pior do que falhar.
      expect(files.files, isEmpty);
      controller.dispose();
    });

    test('falha no download não muda o documento no servidor', () async {
      final backend = Backend(
        preparation: preparationJson(
          actions: const ['DOWNLOAD_DOCUMENT'],
          existing: artifactJson(
            status: 'READY',
            actions: const ['DOWNLOAD_DOCUMENT'],
          ),
        ),
        downloadStatus: 500,
      );
      final controller = build(backend);
      await settle(controller);
      await controller.download();

      expect(controller.state.download.phase, DownloadPhase.error);

      /// Os dois estados são independentes.
      expect(controller.state.status, FieldArtifactStatus.ready);
      controller.dispose();
    });

    test('sem ação publicada, não há download', () async {
      final backend = Backend(
        preparation: preparationJson(
          actions: const [],
          existing: artifactJson(status: 'PENDING', actions: const []),
        ),
      );
      final controller = build(backend);
      await settle(controller);

      await controller.download();
      expect(backend.accesses, isEmpty);
      expect(controller.state.download.phase, DownloadPhase.idle);
      controller.dispose();
    });

    test('descartar a cópia local apaga o arquivo temporário', () async {
      final files = MemoryDocumentFileStore();
      final backend = Backend(
        preparation: preparationJson(
          actions: const ['DOWNLOAD_DOCUMENT'],
          existing: artifactJson(
            status: 'READY',
            actions: const ['DOWNLOAD_DOCUMENT'],
          ),
        ),
      );
      final controller = build(backend, files: files);
      await settle(controller);
      await controller.download();
      expect(files.files, hasLength(1));

      await controller.discardLocalCopy();
      expect(files.files, isEmpty);
      expect(controller.state.download.phase, DownloadPhase.idle);
      controller.dispose();
    });
  });
}
