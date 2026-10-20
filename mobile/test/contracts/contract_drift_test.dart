/// Gate de drift dos contratos.
///
/// Os contratos Dart são **espelhos escritos à mão** dos Read Models do
/// backend — não há geração de código para Flutter. Isso funciona até o dia em
/// que alguém acrescenta um campo no NestJS: o app continua compilando,
/// continua passando nos testes, e simplesmente ignora o dado novo. O erro não
/// aparece; a funcionalidade só não existe.
///
/// Este teste lê o TypeScript do backend e confere, campo a campo, que o
/// espelho Dart cobre o que o Read Model publica. Não valida tipos — valida
/// **cobertura**, que é onde o drift silencioso mora.
///
/// Quando o backend não está disponível no checkout, o teste é pulado com
/// motivo explícito. Um gate que passa por ausência de fonte não é um gate.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

/// Um Read Model do backend e o arquivo Dart que deve espelhá-lo.
class _Mirror {
  const _Mirror({
    required this.readModel,
    required this.source,
    required this.dart,
  });

  final String readModel;
  final String source;

  /// O arquivo Dart que deve espelhar o Read Model.
  ///
  /// Não há lista de exceções de propósito: um campo que o espelho decide não
  /// carregar deveria ser uma decisão discutida, não uma linha silenciosa num
  /// conjunto de ignorados.
  final String dart;
}

const _mirrors = <_Mirror>[
  _Mirror(
    readModel: 'MobileWorkItemReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileFieldSummaryReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileFieldDashboardReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileWorkQueueReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileFieldHomeReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileRecentDocumentReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileRecentAppointmentReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileDocumentsPageReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/features/documents/data/documents_repository.dart',
  ),
  _Mirror(
    readModel: 'MobileFieldContextReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileEquipmentSummaryReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileNavigationContextReadModel',
    source: 'src/modules/mobile-field/mobile-field.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldOperationExecutionPreparationReadModel',
    source: 'src/modules/mobile-field/mobile-field-operation.read-models.ts',
    dart: 'lib/core/contracts/field_operation_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldOperationCommandResultReadModel',
    source: 'src/modules/mobile-field/mobile-field-operation.read-models.ts',
    dart: 'lib/core/contracts/field_operation_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldOperationChecklistReadModel',
    source: 'src/modules/mobile-field/mobile-field-operation.read-models.ts',
    dart: 'lib/core/contracts/field_operation_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldOperationMaterialResultReadModel',
    source: 'src/modules/mobile-field/mobile-field-operation.read-models.ts',
    dart: 'lib/core/contracts/field_operation_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldOperationTimelineEntryReadModel',
    source: 'src/modules/mobile-field/mobile-field-operation.read-models.ts',
    dart: 'lib/core/contracts/field_operation_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileSignatureStatusReadModel',
    source: 'src/modules/mobile-field/mobile-signature.read-models.ts',
    dart: 'lib/core/contracts/mobile_signature_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileSignatureUploadReservationReadModel',
    source: 'src/modules/mobile-field/mobile-signature.read-models.ts',
    dart: 'lib/core/contracts/mobile_signature_contracts.dart',
  ),
  _Mirror(
    readModel: 'ProfessionalSignatureRequirementReadModel',
    source: 'src/modules/mobile-field/mobile-signature.read-models.ts',
    dart: 'lib/core/contracts/mobile_signature_contracts.dart',
  ),
  _Mirror(
    readModel: 'CustomerAcknowledgementPreparationReadModel',
    source: 'src/modules/mobile-field/mobile-signature.read-models.ts',
    dart: 'lib/core/contracts/mobile_signature_contracts.dart',
  ),
  _Mirror(
    readModel: 'CustomerAcknowledgementResultReadModel',
    source: 'src/modules/mobile-field/mobile-signature.read-models.ts',
    dart: 'lib/core/contracts/mobile_signature_contracts.dart',
  ),
  _Mirror(
    readModel: 'AgendaReadModel',
    source: 'src/modules/scheduling/scheduling.read-models.ts',
    dart: 'lib/core/contracts/agenda_contracts.dart',
  ),
  _Mirror(
    readModel: 'EquipmentFieldDetailsReadModel',
    source:
        'src/modules/organizations/business-units/equipaments/equipment-qr.read-models.ts',
    dart: 'lib/core/contracts/equipment_qr_contracts.dart',
  ),
  _Mirror(
    readModel: 'OfflineCommandResultReadModel',
    source: 'src/modules/mobile-field/mobile-offline-sync.read-models.ts',
    dart: 'lib/core/contracts/mobile_offline_sync_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileSyncPushResponseReadModel',
    source: 'src/modules/mobile-field/mobile-offline-sync.read-models.ts',
    dart: 'lib/core/contracts/mobile_offline_sync_contracts.dart',
  ),
  _Mirror(
    readModel: 'MobileSyncPullResponseReadModel',
    source: 'src/modules/mobile-field/mobile-offline-sync.read-models.ts',
    dart: 'lib/core/contracts/mobile_offline_sync_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldPackageReadModel',
    source: 'src/modules/mobile-field/mobile-offline-sync.read-models.ts',
    dart: 'lib/core/contracts/mobile_offline_sync_contracts.dart',
  ),
  _Mirror(
    readModel: 'EvidenceUploadIntentReadModel',
    source: 'src/modules/mobile-field/mobile-evidence.read-models.ts',
    dart: 'lib/core/contracts/mobile_evidence_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldEvidenceReadModel',
    source: 'src/modules/mobile-field/mobile-evidence.read-models.ts',
    dart: 'lib/core/contracts/mobile_evidence_contracts.dart',
  ),
  _Mirror(
    readModel: 'EvidenceAccessReadModel',
    source: 'src/modules/mobile-field/mobile-evidence.read-models.ts',
    dart: 'lib/core/contracts/mobile_evidence_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldArtifactReadModel',
    source: 'src/modules/mobile-field/mobile-field-artifact.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_artifact_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldArtifactPreparationReadModel',
    source: 'src/modules/mobile-field/mobile-field-artifact.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_artifact_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldArtifactEligibilityReadModel',
    source: 'src/modules/mobile-field/mobile-field-artifact.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_artifact_contracts.dart',
  ),
  /*
   * O PMOC entrou no espelho quando o atendimento passou a existir no celular.
   * Antes disso o app só lia PMOC de raspão, e um campo novo no plano não
   * mudava nada aqui; agora o técnico atende por estes dados.
   */
  _Mirror(
    readModel: 'PmocPlanSummaryReadModel',
    source: 'src/modules/pmoc/pmoc.read-models.ts',
    dart: 'lib/core/contracts/pmoc_contracts.dart',
  ),
  _Mirror(
    readModel: 'PmocPlanReadModel',
    source: 'src/modules/pmoc/pmoc.read-models.ts',
    dart: 'lib/core/contracts/pmoc_contracts.dart',
  ),
  _Mirror(
    readModel: 'PmocExecutionReadModel',
    source: 'src/modules/pmoc/pmoc.read-models.ts',
    dart: 'lib/core/contracts/pmoc_contracts.dart',
  ),
  _Mirror(
    readModel: 'PmocEquipmentExecutionReadModel',
    source: 'src/modules/pmoc/pmoc.read-models.ts',
    dart: 'lib/core/contracts/pmoc_contracts.dart',
  ),
  _Mirror(
    readModel: 'FieldArtifactDownloadReadModel',
    source: 'src/modules/mobile-field/mobile-field-artifact.read-models.ts',
    dart: 'lib/core/contracts/mobile_field_artifact_contracts.dart',
  ),
];

void main() {
  final backend = Directory('../backend');

  group('espelhos de contrato', () {
    for (final mirror in _mirrors) {
      test('${mirror.readModel} não tem campo ignorado pelo app', () {
        final source = File('${backend.path}/${mirror.source}');
        if (!source.existsSync()) {
          markTestSkipped('backend ausente: ${mirror.source}');
          return;
        }

        final fields = _fieldsOf(source.readAsStringSync(), mirror.readModel);
        expect(
          fields,
          isNotEmpty,
          reason: '${mirror.readModel} não foi encontrado em ${mirror.source}',
        );

        final dart = File(mirror.dart).readAsStringSync();
        final missing = fields
            .where((field) => !_mentions(dart, field))
            .toList();

        expect(
          missing,
          isEmpty,
          reason:
              'campos publicados pelo backend e ausentes no espelho Dart: '
              '${missing.join(', ')}',
        );
      });
    }
  });
}

/// Nomes de campo declarados no corpo de uma interface/type do TypeScript.
///
/// Leitura deliberadamente simples: pega do nome até a primeira chave de
/// fechamento no mesmo nível. Um parser completo de TypeScript seria mais
/// preciso e muito mais fácil de quebrar.
List<String> _fieldsOf(String source, String name) {
  final declaration = RegExp(
    'export (?:interface|type) $name\\b[^{]*\\{',
  ).firstMatch(source);
  if (declaration == null) return const [];

  var depth = 1;
  var index = declaration.end;
  final body = StringBuffer();
  while (index < source.length && depth > 0) {
    final char = source[index];
    if (char == '{') depth += 1;
    if (char == '}') depth -= 1;
    if (depth > 0) body.write(char);
    index += 1;
  }

  /// Só o primeiro nível: campos aninhados pertencem ao objeto interno, e o
  /// espelho pode representá-los de outra forma.
  final fields = <String>[];
  var nesting = 0;
  for (final line in body.toString().split('\n')) {
    final trimmed = line.trim();
    if (nesting == 0) {
      final match = RegExp(
        r'^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:',
      ).firstMatch(trimmed);
      if (match != null) fields.add(match.group(1)!);
    }
    nesting += '{'.allMatches(trimmed).length;
    nesting -= '}'.allMatches(trimmed).length;
    if (nesting < 0) nesting = 0;
  }
  return fields;
}

/// O espelho menciona o campo?
///
/// Aceita tanto o nome exato quanto a chave JSON entre aspas — é assim que os
/// contratos Dart leem o payload.
bool _mentions(String dart, String field) =>
    dart.contains("'$field'") || RegExp('\\b$field\\b').hasMatch(dart);
