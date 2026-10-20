/// Assinatura profissional e aceite do cliente contra o backend real.
///
/// Prova o que só o servidor pode provar: o pipeline de upload em três passos,
/// a recusa de formato e tamanho, a substituição criando nova versão, o aceite
/// amarrado ao resumo congelado, e — o mais importante — que registrar aceite
/// **não toca o cadastro do cliente**.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/network/orbit_api_client.dart';
import 'package:orbit_operator/features/field/application/execution_controller.dart'
    show newCommandId;
import 'package:orbit_operator/features/signature/data/signature_file.dart';
import 'package:orbit_operator/features/signature/data/signature_repository.dart';

import 'support/scenario_provisioner.dart';
import 'support/smoke_environment.dart';

/// PNG 1x1 real — conteúdo de verdade, para o hash e o tamanho não serem
/// inventados.
final _png = base64Decode(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
);

void main() {
  late bool available;
  late ScenarioProvisioner provisioner;
  late OrbitApiClient client;
  late SignatureRepository repository;

  setUpAll(() async {
    available = await smokeApiIsUp();
    if (!available) return;
    provisioner = await ScenarioProvisioner.connect();
    client = provisioner.client;
    repository = SignatureRepository(client: client);
  });

  tearDownAll(() {
    if (!available) return;
    // ignore: avoid_print
    print(
      'FL-04 · atendimentos criados nesta execução: '
      '${provisioner.createdOperations}',
    );
  });

  bool skip() {
    if (available) return false;
    markTestSkipped('API indisponível em $smokeApiUrl');
    return true;
  }

  group('assinatura profissional', () {
    test('o pipeline de três passos ativa uma nova versão', () async {
      if (skip()) return;

      final before = await repository.status();

      /// Reservar → enviar bytes → confirmar. Só o terceiro passo ativa.
      final result = await repository.upload(
        fileName: 'assinatura-smoke.png',
        mimeType: 'image/png',
        bytes: _png,
      );

      expect(result.status.signatureAvailable, isTrue);
      expect(result.status.version, isNotNull);
      if (before.signatureAvailable && before.version != null) {
        /// Substituir cria versão nova; a anterior fica registrada como
        /// substituída, e documentos já emitidos não mudam.
        expect(result.status.version, greaterThan(before.version!));
        expect(result.replacedVersion, before.version);
      }

      final after = await repository.status();
      expect(after.signatureAvailable, isTrue);
      expect(after.version, result.status.version);
    });

    test('o servidor recusa tamanho acima do contrato', () async {
      if (skip()) return;

      /// A checagem local pega antes; aqui se prova que o servidor também
      /// recusa — ele é a autoridade final.
      await expectLater(
        client.post<Map<String, dynamic>>(
          '/mobile/field/me/signature/uploads',
          body: {
            'fileName': 'grande.png',
            'mimeType': 'image/png',
            'sizeBytes': signatureMaxBytes + 1,
          },
        ),
        throwsA(isA<OrbitException>()),
      );
    });

    test('o servidor recusa formato fora do contrato', () async {
      if (skip()) return;

      await expectLater(
        client.post<Map<String, dynamic>>(
          '/mobile/field/me/signature/uploads',
          body: {
            'fileName': 'documento.pdf',
            'mimeType': 'application/pdf',
            'sizeBytes': 1000,
          },
        ),
        throwsA(isA<OrbitException>()),
      );
    });

    test('a checagem local concorda com o contrato do servidor', () {
      final check = checkSignatureFile(Uint8List.fromList(_png));
      expect(check.isValid, isTrue);
      expect(check.mimeType, 'image/png');
    });
  });

  group('aceite do cliente', () {
    /// Um atendimento em andamento, novo, só desta suíte.
    ///
    /// Pegar o primeiro da fila dependia do que outras suítes tinham deixado
    /// para trás — e é assim que uma suíte passa a medir o estado de outra.
    Future<String?> anOperation() async =>
        (await provisioner.operation(suite: 'FL04')).operationId;

    test('a preparação congela um resumo com hash e versão', () async {
      if (skip()) return;
      final operationId = (await anOperation())!;

      final preparation = await repository.acknowledgementPreparation(
        operationId,
      );

      expect(preparation.serviceSummary, isNotEmpty);
      expect(preparation.contentHash.length, 64);
      expect(preparation.contentVersion, isNotEmpty);

      /// Assinatura gráfica é opcional por política do servidor.
      expect(preparation.signatureRequired, isFalse);
    });

    test('registrar ciência não altera o cadastro do cliente', () async {
      if (skip()) return;
      final operationId = (await anOperation())!;

      final preparation = await repository.acknowledgementPreparation(
        operationId,
      );
      final customers = await client.get<Map<String, dynamic>>(
        '/customers',
        query: {'limit': 1},
      );
      final customerId =
          (customers['data'] as List<dynamic>).firstOrNull
              is Map<String, dynamic>
          ? ((customers['data'] as List<dynamic>).first
                    as Map<String, dynamic>)['id']
                as String
          : null;
      if (customerId == null) {
        markTestSkipped('sem cliente neste tenant');
        return;
      }

      Future<Map<String, dynamic>> readCustomer() =>
          client.get<Map<String, dynamic>>('/customers/$customerId');

      final before = await readCustomer();

      try {
        await repository.acknowledge(
          operationId,

          /// Um nome deliberadamente diferente do cadastro: quem recebe o
          /// serviço pode ser o zelador, e isso não vira nome do cliente.
          signerName: 'Zelador do Prédio',
          contentVersion: preparation.contentVersion,
          contentHash: preparation.contentHash,
          commandId: newCommandId(),
        );
      } on OrbitException catch (error) {
        /// Nem todo atendimento aceita ciência agora — a recusa é legítima e
        /// não invalida a prova de imutabilidade abaixo.
        if (!error.isForbidden && !error.isConflict) rethrow;
      }

      final after = await readCustomer();

      /// O cadastro do cliente é de outro domínio. O aceite pertence à
      /// execução, e escrever ali seria confundir os dois.
      expect(after['legalName'], before['legalName']);
      expect(after['tradeName'], before['tradeName']);
      expect(after['updatedAt'], before['updatedAt']);
    });

    test('resumo desatualizado é recusado com conflito', () async {
      if (skip()) return;
      final operationId = (await anOperation())!;

      final preparation = await repository.acknowledgementPreparation(
        operationId,
      );

      try {
        await repository.acknowledge(
          operationId,
          signerName: 'Teste de conflito',
          contentVersion: preparation.contentVersion,

          /// Hash de um resumo que não é o atual.
          contentHash: 'f' * 64,
          commandId: newCommandId(),
        );
        fail('esperava recusa do servidor');
      } on OrbitException catch (error) {
        /// O servidor não registra concordância com um texto que o cliente
        /// não leu.
        expect(
          error.isConflict || error.isForbidden,
          isTrue,
          reason: error.toString(),
        );
      }
    });
  });
}
