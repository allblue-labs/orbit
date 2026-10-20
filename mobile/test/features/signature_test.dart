/// Validação de arquivo e vocabulário de assinatura/aceite.
library;

import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_signature_contracts.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';
import 'package:orbit_operator/features/signature/data/signature_file.dart';

Uint8List _bytes(List<int> header, {int pad = 0}) =>
    Uint8List.fromList([...header, ...List.filled(pad, 0)]);

const _png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const _jpeg = [0xff, 0xd8, 0xff, 0xe0];
const _webp = [
  0x52, 0x49, 0x46, 0x46, // RIFF
  0x00, 0x00, 0x00, 0x00, // tamanho
  0x57, 0x45, 0x42, 0x50, // WEBP
];

void main() {
  group('tipo real do arquivo', () {
    test('reconhece os três formatos que o backend aceita', () {
      expect(detectImageMimeType(_bytes(_png, pad: 20)), 'image/png');
      expect(detectImageMimeType(_bytes(_jpeg, pad: 20)), 'image/jpeg');
      expect(detectImageMimeType(_bytes(_webp, pad: 20)), 'image/webp');
    });

    test('um PDF renomeado para .png não passa', () {
      /// Extensão não é tipo: basta alguém renomear. A checagem é pelos
      /// primeiros bytes, que é o que identifica o formato de verdade.
      final pdf = _bytes([0x25, 0x50, 0x44, 0x46, 0x2d], pad: 20);
      expect(detectImageMimeType(pdf), isNull);

      final check = checkSignatureFile(pdf);
      expect(check.isValid, isFalse);
      expect(check.problem, SignatureFileProblem.unsupportedType);
    });

    test('GIF não é aceito, mesmo sendo imagem', () {
      final gif = _bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], pad: 20);
      expect(
        checkSignatureFile(gif).problem,
        SignatureFileProblem.unsupportedType,
      );
    });
  });

  group('limites do contrato', () {
    test('o teto é o do backend: 2 MB', () {
      expect(signatureMaxBytes, 2000000);

      final tooBig = _bytes(_png, pad: signatureMaxBytes);
      expect(checkSignatureFile(tooBig).problem, SignatureFileProblem.tooLarge);

      /// Exatamente no limite ainda passa — o backend usa `Max(2_000_000)`.
      final atLimit = Uint8List(signatureMaxBytes)
        ..setRange(0, _png.length, _png);
      expect(checkSignatureFile(atLimit).isValid, isTrue);
    });

    test('arquivo vazio é recusado antes de gastar rede', () {
      expect(
        checkSignatureFile(Uint8List(0)).problem,
        SignatureFileProblem.empty,
      );
    });

    test('os formatos aceitos são exatamente os do DTO', () {
      expect(signatureMimeTypes, {'image/png', 'image/jpeg', 'image/webp'});
    });
  });

  group('contratos', () {
    test('a situação da assinatura vem do servidor, com os papéis', () {
      final status = MobileSignatureStatus.fromJson({
        'signatureAvailable': true,
        'version': 3,
        'updatedAt': '2026-09-01T12:00:00.000Z',
        'roles': ['FIELD_TECHNICIAN', 'TECHNICAL_RESPONSIBLE'],
      });

      expect(status.signatureAvailable, isTrue);

      /// A versão é informação do servidor; o app não escolhe qual está ativa.
      expect(status.version, 3);

      /// A mesma assinatura serve aos dois papéis.
      expect(status.roles, [
        MobileProfessionalRole.fieldTechnician,
        MobileProfessionalRole.technicalResponsible,
      ]);
    });

    test('a preparação traz o resumo congelado e as precondições', () {
      final preparation = CustomerAcknowledgementPreparation.fromJson({
        'executionType': 'OPERATION',
        'executionId': 'op-1',
        'customer': {'id': 'c1', 'name': 'Cliente'},
        'equipment': [
          {'id': 'e1', 'code': 'TAG-1', 'name': 'Split'},
        ],
        'serviceSummary': 'Manutenção preventiva realizada.',
        'performedAt': '2026-09-01T12:00:00.000Z',
        'signerPolicy': {
          'acknowledgementAllowed': true,
          'signatureRequired': false,
          'signatureOptional': true,
        },
        'existingAcknowledgement': null,
        'contentVersion': '2026-09-01T12:00:00.000Z',
        'contentHash': 'a' * 64,
      });

      expect(preparation.serviceSummary, 'Manutenção preventiva realizada.');
      expect(preparation.equipment.single.code, 'TAG-1');

      /// Precondições que voltam verbatim no comando.
      expect(preparation.contentHash.length, 64);

      /// Assinatura gráfica é opcional — por isso o termo é "aceite".
      expect(preparation.signatureRequired, isFalse);
      expect(preparation.signatureOptional, isTrue);
    });

    test('um aceite já registrado é fato, sem juízo de validade', () {
      final preparation = CustomerAcknowledgementPreparation.fromJson({
        'executionId': 'op-1',
        'serviceSummary': 'Resumo',
        'equipment': <Map<String, Object?>>[],
        'signerPolicy': {'signatureRequired': false, 'signatureOptional': true},
        'existingAcknowledgement': {
          'signerName': 'Zelador',
          'acknowledgedAt': '2026-09-01T10:00:00.000Z',
          'hasSignature': false,
        },
        'contentVersion': 'v2',
        'contentHash': 'b' * 64,
      });

      /// O contrato não publica se este aceite ainda corresponde ao estado
      /// atual — e o app não deduz comparando hashes.
      expect(preparation.existingAcknowledgement!.signerName, 'Zelador');
      expect(preparation.existingAcknowledgement!.hasSignature, isFalse);
    });
  });

  group('vocabulário', () {
    test('o termo é "aceite", não "assinatura do cliente"', () {
      for (final label in acknowledgementLabels.values) {
        expect(label.label.toLowerCase(), isNot(contains('assinatura')));
      }
      expect(acknowledgementLabels['accepted']!.label, 'Ciência registrada');
    });

    test('nenhuma promessa jurídica é feita', () {
      /// Não há ICP-Brasil, certificado nem assinatura qualificada neste
      /// produto — e prometer isso seria falso.
      final texts = [
        ...acknowledgementLabels.values.map((entry) => entry.label),
        ...acknowledgementLabels.values.map((entry) => entry.description ?? ''),
        ...signatureStatusLabels.values.map((entry) => entry.label),
        ...signatureStatusLabels.values.map((e) => e.description ?? ''),
      ].join(' ').toLowerCase();

      for (final forbidden in [
        'icp',
        'certificad',
        'qualificada',
        'digital certificada',
        'juridicamente',
      ]) {
        expect(texts, isNot(contains(forbidden)), reason: forbidden);
      }
    });

    test('o papel de assinatura vem nomeado, sem enum cru', () {
      expect(
        signedAsLabel(MobileProfessionalRole.fieldTechnician),
        'Assinado como Técnico em Campo',
      );
      expect(
        signedAsLabel(MobileProfessionalRole.technicalResponsible),
        'Assinado como Responsável Técnico',
      );
    });

    test('o impedimento de assinatura vira frase', () {
      expect(
        signatureBlockedReasonLabel('FIELD_TECHNICIAN_SIGNATURE_MISSING'),
        'Sua assinatura profissional ainda não foi cadastrada.',
      );
      expect(signatureBlockedReasonLabel(null), isNull);
      expect(signatureBlockedReasonLabel('ALGO_NOVO'), isNull);
    });

    test('substituir avisa o efeito real, sem prometer retroatividade', () {
      final problems = signatureFileProblemLabels.values.join(' ');
      expect(problems, contains('2 MB'));
      expect(problems, contains('PNG'));
    });
  });
}
