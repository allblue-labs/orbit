/// Os contratos do atendimento avulso, na borda.
///
/// O que se garante aqui é o que a borda tem de absorver sem estourar: campo
/// ausente, lista ausente, endereço pela metade. O aplicativo abre este fluxo
/// na calçada, e uma exceção de parsing ali custa o atendimento.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/walk_in_contracts.dart';

void main() {
  group('cliente da carteira', () {
    test('usa o nome fantasia quando existe', () {
      final cliente = WalkInCustomerContract.fromJson({
        'id': 'c1',
        'legalName': 'CLIMA NORTE LTDA',
        'tradeName': 'Clima Norte',
      });

      expect(cliente.displayName, 'Clima Norte');
    });

    /// É o nome que a equipe usa. Sem fantasia, a razão social é o que há.
    test('cai na razão social quando não há fantasia', () {
      final cliente = WalkInCustomerContract.fromJson({
        'id': 'c1',
        'legalName': 'CLIMA NORTE LTDA',
      });

      expect(cliente.displayName, 'CLIMA NORTE LTDA');
    });

    test('fantasia em branco não vence a razão social', () {
      final cliente = WalkInCustomerContract.fromJson({
        'id': 'c1',
        'legalName': 'CLIMA NORTE LTDA',
        'tradeName': '   ',
      });

      expect(cliente.displayName, 'CLIMA NORTE LTDA');
    });

    test('sem endereços, a lista vem vazia e não nula', () {
      final cliente = WalkInCustomerContract.fromJson({
        'id': 'c1',
        'legalName': 'Clima Norte',
      });

      expect(cliente.addresses, isEmpty);
    });

    test('reconhece pessoa física', () {
      final pessoa = WalkInCustomerContract.fromJson({
        'id': 'c1',
        'legalName': 'Maria Souza',
        'type': 'INDIVIDUAL',
      });

      expect(pessoa.isIndividual, isTrue);
    });
  });

  group('endereço em uma linha', () {
    test('junta rua, número, bairro, cidade e UF', () {
      final endereco = WalkInAddressContract.fromJson({
        'id': 'a1',
        'street': 'Avenida Rio Branco',
        'number': '120',
        'district': 'Recife',
        'city': 'Recife',
        'stateCode': 'PE',
      });

      expect(
        endereco.oneLine,
        'Avenida Rio Branco, 120 · Recife · Recife - PE',
      );
    });

    /// Endereço pela metade é o caso normal de um cadastro feito em campo.
    /// A linha não pode sair com vírgulas e pontos soltos.
    test('endereço incompleto não deixa separador sobrando', () {
      final endereco = WalkInAddressContract.fromJson({
        'id': 'a1',
        'street': 'Rua das Flores',
        'city': 'Olinda',
      });

      expect(endereco.oneLine, 'Rua das Flores · Olinda');
    });

    test('endereço vazio produz linha vazia, e não um punhado de pontos', () {
      final endereco = WalkInAddressContract.fromJson({'id': 'a1'});

      expect(endereco.oneLine, '');
    });

    test('o ponto de referência chega do campo de notas do servidor', () {
      final endereco = WalkInAddressContract.fromJson({
        'id': 'a1',
        'street': 'Rua das Flores',
        'city': 'Olinda',
        'reference': 'Casa amarela depois do posto',
      });

      expect(endereco.reference, 'Casa amarela depois do posto');
    });
  });

  group('equipamento', () {
    test('o subtítulo junta o que existir', () {
      final equipamento = WalkInEquipmentContract.fromJson({
        'id': 'e1',
        'name': 'Split do quarto',
        'manufacturer': 'Daikin',
        'location': 'Suíte 1',
      });

      expect(equipamento.subtitle, 'Daikin · Suíte 1');
    });

    test('sem nenhum detalhe, o subtítulo é vazio', () {
      final equipamento = WalkInEquipmentContract.fromJson({
        'id': 'e1',
        'name': 'Split do quarto',
      });

      expect(equipamento.subtitle, '');
    });
  });

  group('consultas públicas', () {
    test('o endereço do CEP chega inteiro', () {
      final endereco = PostalAddressContract.fromJson({
        'postalCode': '50030230',
        'street': 'Avenida Rio Branco',
        'district': 'Recife',
        'city': 'Recife',
        'state': 'Pernambuco',
        'stateCode': 'PE',
        'country': 'Brasil',
      });

      expect(endereco.city, 'Recife');
      expect(endereco.country, 'Brasil');
    });

    /// O país é consequência de a consulta ter dado certo. Ausente, o padrão
    /// honesto é o único país que o serviço conhece.
    test('sem país na resposta, assume Brasil', () {
      final endereco = PostalAddressContract.fromJson({'city': 'Recife'});

      expect(endereco.country, 'Brasil');
    });

    test('a empresa chega com endereço aninhado', () {
      final empresa = CompanyLookupContract.fromJson({
        'documentNumber': '19131243000197',
        'legalName': 'CLIMA NORTE LTDA',
        'tradeName': 'Clima Norte',
        'address': {
          'postalCode': '50030230',
          'street': 'Avenida Rio Branco',
          'number': '120',
          'city': 'Recife',
          'stateCode': 'PE',
        },
      });

      expect(empresa.legalName, 'CLIMA NORTE LTDA');
      expect(empresa.address.number, '120');
    });

    /// Sem o bloco de endereço o parsing não pode estourar: o provedor omite
    /// endereço de empresa baixada, e isso não deve derrubar a tela.
    test('empresa sem bloco de endereço não estoura', () {
      final empresa = CompanyLookupContract.fromJson({
        'documentNumber': '19131243000197',
        'legalName': 'CLIMA NORTE LTDA',
      });

      expect(empresa.address.street, '');
      expect(empresa.address.number, isNull);
    });
  });

  group('resultado do comando', () {
    test('lê a ordem aberta e a marca de reenvio', () {
      final resultado = WalkInResultContract.fromJson({
        'operationId': 'op-1',
        'idempotency': {'key': 'walkin-1', 'replayed': true},
      });

      expect(resultado.operationId, 'op-1');
      expect(resultado.replayed, isTrue);
    });

    /// Sem o bloco de idempotência, "não foi reenvio" é o padrão seguro: a
    /// tela anuncia a criação uma vez, que é o que de fato aconteceu.
    test('sem bloco de idempotência, não é reenvio', () {
      final resultado = WalkInResultContract.fromJson({'operationId': 'op-1'});

      expect(resultado.replayed, isFalse);
    });
  });
}
