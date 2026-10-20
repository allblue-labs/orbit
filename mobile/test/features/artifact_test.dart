/// Documento de campo: contratos, estados e verificação do arquivo.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_field_artifact_contracts.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';
import 'package:orbit_operator/features/artifact/application/artifact_controller.dart';
import 'package:orbit_operator/features/artifact/data/document_file.dart';

Map<String, Object?> artifactJson({
  String status = 'READY',
  List<String> actions = const ['VIEW_DOCUMENT', 'DOWNLOAD_DOCUMENT'],
  String? generatedAt = '2026-09-02T10:00:00.000Z',
  int snapshotVersion = 1,
}) => {
  'id': 'art-1',
  'artifactExecutionId': 'exec-1',
  'sourceType': 'OPERATION',
  'sourceId': 'op-1',
  'documentType': 'SERVICE_ORDER',
  'status': status,
  'snapshotVersion': snapshotVersion,
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
  int pendingEvidence = 0,
  bool acknowledgementValid = true,
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
    'required': true,
    'available': true,
    'valid': acknowledgementValid,
  },
  'evidenceSummary': {'finalized': 4, 'pending': pendingEvidence},
  'snapshotVersion': 1,
  'existingArtifact': existing,
  'allowedActions': actions,
};

void main() {
  group('estado do documento', () {
    test('cada estado do servidor tem nome em português', () {
      for (final status in FieldArtifactStatus.values) {
        expect(
          documentStatusLabels[status.name],
          isNotNull,
          reason: '${status.name} sem rótulo vira enum cru na tela',
        );
      }
    });

    test('estado desconhecido não lança nem vira código cru', () {
      /// Uma versão nova do servidor não pode deixar a tela do documento em
      /// branco no meio de um atendimento.
      final artifact = FieldArtifact.fromJson(
        artifactJson(status: 'ALGO_QUE_O_APP_NAO_CONHECE'),
      );
      expect(artifact.status, FieldArtifactStatus.unknown);
      expect(
        documentStatusLabels['unknown']!.label,
        'Situação do documento indisponível',
      );
    });

    test('ação desconhecida some da lista em vez de virar botão sem nome', () {
      final artifact = FieldArtifact.fromJson(
        artifactJson(actions: ['VIEW_DOCUMENT', 'ALGO_NOVO']),
      );
      expect(artifact.allowedActions, [
        FieldArtifactAllowedAction.viewDocument,
      ]);
    });

    test('só pending e rendering são transitórios', () {
      expect(fieldArtifactIsTransient(FieldArtifactStatus.pending), isTrue);
      expect(fieldArtifactIsTransient(FieldArtifactStatus.rendering), isTrue);

      /// Fora deles não há o que esperar — continuar perguntando gastaria
      /// bateria para receber sempre a mesma resposta.
      expect(fieldArtifactIsTransient(FieldArtifactStatus.ready), isFalse);
      expect(fieldArtifactIsTransient(FieldArtifactStatus.failed), isFalse);
      expect(fieldArtifactIsTransient(FieldArtifactStatus.prepared), isFalse);
      expect(fieldArtifactIsTransient(FieldArtifactStatus.unknown), isFalse);
    });
  });

  group('preparação', () {
    test('publica a validade do aceite, decidida pelo servidor', () {
      final stale = FieldArtifactPreparation.fromJson(
        preparationJson(
          acknowledgementValid: false,
          eligible: false,
          blocked: const ['ACKNOWLEDGEMENT_STALE'],
        ),
      );

      /// O app não compara hash nem recalcula validade — lê o que veio.
      expect(stale.customerAcknowledgement.valid, isFalse);
      expect(stale.eligibility.blockedReasons, [
        FieldArtifactBlockedReason.acknowledgementStale,
      ]);
    });

    test('evidência pendente é contagem do servidor, não da fila local', () {
      final value = FieldArtifactPreparation.fromJson(
        preparationJson(pendingEvidence: 2),
      );
      expect(value.evidenceSummary.pending, 2);
      expect(value.evidenceSummary.finalized, 4);
    });

    test('sem artefato, não há artefato — e não se inventa um', () {
      final value = FieldArtifactPreparation.fromJson(preparationJson());
      expect(value.existingArtifact, isNull);
    });

    test('com artefato, o vigente vem junto na mesma resposta', () {
      /// Uma requisição resolve a seção inteira: situação, bloqueios, ações e
      /// o artefato. Nada de N+1 para signatários ou evidências.
      final value = FieldArtifactPreparation.fromJson(
        preparationJson(existing: artifactJson()),
      );
      expect(value.existingArtifact?.id, 'art-1');
      expect(value.existingArtifact?.status, FieldArtifactStatus.ready);
    });
  });

  group('bloqueios', () {
    test('todo motivo publicado vira frase útil', () {
      for (final reason in FieldArtifactBlockedReason.values) {
        final label = documentBlockedLabel(reason.name);
        expect(label, isNotEmpty);
        expect(label, isNot(contains('_')), reason: 'código cru não é frase');
      }
    });

    test('motivo desconhecido cai num texto neutro', () {
      final value = FieldArtifactPreparation.fromJson(
        preparationJson(
          eligible: false,
          blocked: const ['MOTIVO_QUE_O_APP_NAO_CONHECE'],
        ),
      );
      expect(value.eligibility.blockedReasons, [
        FieldArtifactBlockedReason.unknown,
      ]);
      expect(
        documentBlockedLabel('unknown'),
        'O documento ainda não pode ser emitido.',
      );
    });

    test('assinatura faltando aponta onde resolver', () {
      expect(
        documentBlockedLabel('fieldTechnicianSignatureMissing'),
        contains('Minha assinatura'),
      );
    });
  });

  group('acesso assinado', () {
    test('carrega validade e não é estado de domínio', () {
      final access = FieldArtifactAccess.fromJson({
        'artifactId': 'art-1',
        'operation': 'download',
        'url': 'https://storage.example/doc.pdf?sig=abc',
        'expiresAt': '2099-01-01T00:00:00.000Z',
        'requiredHeaders': const {'Accept': 'application/pdf'},
      });
      expect(access.isExpired, isFalse);
      expect(access.requiredHeaders['Accept'], 'application/pdf');
    });

    test('URL vencida é reconhecida como vencida', () {
      final access = FieldArtifactAccess.fromJson({
        'artifactId': 'art-1',
        'operation': 'preview',
        'url': 'https://storage.example/doc.pdf',
        'expiresAt': '2020-01-01T00:00:00.000Z',
        'requiredHeaders': const <String, Object?>{},
      });
      expect(access.isExpired, isTrue);
    });
  });

  group('verificação do arquivo', () {
    final pdf = utf8.encode('%PDF-1.7 conteúdo do documento');

    test('um PDF de verdade passa', () {
      expect(checkDocumentBytes(pdf), isNull);
    });

    test('o Content-Type não é prova, e por isso não é consultado', () {
      /// O storage do Orbit devolve `application/octet-stream` para um PDF
      /// legítimo. Exigir `application/pdf` recusaria o documento real do
      /// produto — o cabeçalho é o que o servidor diz, a assinatura é o que o
      /// arquivo é.
      expect(checkDocumentBytes(pdf), isNull);
    });

    test('página de erro com status 200 não passa', () {
      /// Um proxy devolvendo HTML é exatamente o caso em que só o cabeçalho
      /// engana. Abrir isso como documento do cliente é pior do que falhar.
      expect(
        checkDocumentBytes(utf8.encode('<html><body>Erro</body></html>')),
        DocumentFileProblem.notPdf,
      );
    });

    test('uma imagem não vira documento', () {
      expect(
        checkDocumentBytes(const [0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
        DocumentFileProblem.notPdf,
      );
    });

    test('resposta vazia não passa', () {
      expect(checkDocumentBytes(const []), DocumentFileProblem.empty);
    });
  });

  group('nome do arquivo', () {
    test('é legível e traz a versão', () {
      expect(
        documentFileName(documentType: 'serviceOrder', snapshotVersion: 2),
        'serviceOrder-v2.pdf',
      );
    });

    test('não usa identificador opaco como nome', () {
      /// O contrato mobile não publica `filename`; o nome é construído do que
      /// é publicado. Um `artifactId` como nome de anexo é inútil para quem
      /// vai abrir o e-mail.
      final name = documentFileName(
        documentType: 'serviceOrder',
        snapshotVersion: 1,
        reference: 'OS-0042',
      );
      expect(name, 'OS-0042-v1.pdf');
      expect(name, isNot(contains('art-')));
    });

    test('caracteres perigosos de caminho não sobrevivem', () {
      final name = documentFileName(
        documentType: 'x',
        snapshotVersion: 1,
        reference: '../../etc/passwd',
      );
      expect(name, isNot(contains('/')));
      expect(name, isNot(contains('..')));
    });
  });

  group('estado do download', () {
    test('é separado do estado do documento', () {
      /// O PDF pode estar pronto no servidor e o download ter falhado aqui.
      /// Fundir os dois faria "não consegui baixar" parecer "não existe".
      const state = ArtifactState(
        download: DownloadState(phase: DownloadPhase.error),
      );
      expect(state.download.phase, DownloadPhase.error);
      expect(state.status, FieldArtifactStatus.notPrepared);
    });

    test('cada fase visível tem texto', () {
      for (final phase in DownloadPhase.values) {
        if (phase == DownloadPhase.idle) continue;
        expect(documentDownloadLabels[phase.name], isNotNull);
      }
    });
  });

  group('ritmo das consultas', () {
    test('cresce e tem fim', () {
      expect(renderPollInterval(1) <= renderPollInterval(4), isTrue);
      expect(renderPollInterval(4) <= renderPollInterval(11), isTrue);
      expect(renderPollInterval(99), const Duration(seconds: 60));

      /// Um documento que não ficou pronto em muitas tentativas não vai ficar
      /// por insistência.
      expect(renderPollLimit, lessThanOrEqualTo(50));
    });
  });

  group('vocabulário', () {
    test('a tela não fala a língua do motor de renderização', () {
      final all = [
        ...documentStatusLabels.values.map(
          (v) => '${v.label} ${v.description}',
        ),
        ...documentBlockedLabels.values,
        ...documentActionLabels.values,
        ...documentDownloadLabels.values,
      ].join(' ');

      for (final jargon in [
        'Artifact',
        'Render Job',
        'Snapshot Hash',
        'RENDERING',
        'PENDING',
      ]) {
        expect(all, isNot(contains(jargon)), reason: '$jargon é jargão');
      }
    });

    test('concluir não é emitir, e a tela não promete o contrário', () {
      expect(
        documentStatusLabels['notPrepared']!.description,
        contains('etapa à parte'),
      );
    });
  });
}
