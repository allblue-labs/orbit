/// O rascunho do atendimento avulso, antes de virar ordem.
///
/// ## O que estes testes protegem
///
/// As decisões de "o que enviar", que erram em silêncio: um endereço só com CEP
/// cadastra um endereço que não diz onde é; `customerId` junto com os dados de
/// um cliente novo faz o servidor recusar **depois** de a pessoa preencher tudo;
/// um equipamento sem nome cria um aparelho anônimo no parque do cliente.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/features/walk_in/data/walk_in_draft.dart';

void main() {
  group('cliente da carteira', () {
    const rascunho = WalkInDraft(
      origin: WalkInOrigin.existing,
      customerId: 'cliente-1',
    );

    test('manda o identificador e nada de cliente novo', () {
      final corpo = rascunho.toJson();

      expect(corpo['customerId'], 'cliente-1');
      expect(corpo.containsKey('customer'), isFalse);
    });

    test('está pronto com o cliente escolhido', () {
      expect(rascunho.isReady, isTrue);
      expect(rascunho.blockedReason, isNull);
    });

    test('sem cliente escolhido, diz o que falta', () {
      const vazio = WalkInDraft(origin: WalkInOrigin.existing);

      expect(vazio.isReady, isFalse);
      expect(vazio.blockedReason, 'Escolha o cliente deste atendimento.');
    });

    /// Os dois caminhos nunca viajam juntos.
    ///
    /// O servidor recusa — e com razão: aceitar os dois o obrigaria a escolher
    /// qual vale. Deixar a recusa para a resposta faria a pessoa descobrir o
    /// erro depois do formulário inteiro.
    test('cliente novo preenchido por engano não viaja na origem carteira', () {
      const confuso = WalkInDraft(
        origin: WalkInOrigin.existing,
        customerId: 'cliente-1',
        customer: WalkInCustomerDraft(
          type: 'COMPANY',
          legalName: 'Resto de um preenchimento anterior',
        ),
      );

      final corpo = confuso.toJson();

      expect(corpo.containsKey('customer'), isFalse);
      expect(corpo['customerId'], 'cliente-1');
    });

    test('equipamentos escolhidos viajam como ids', () {
      const comEquipamentos = WalkInDraft(
        origin: WalkInOrigin.existing,
        customerId: 'cliente-1',
        assetIds: ['asset-1', 'asset-2'],
      );

      expect(comEquipamentos.toJson()['assetIds'], ['asset-1', 'asset-2']);
    });
  });

  group('cliente novo', () {
    const rascunho = WalkInDraft(
      origin: WalkInOrigin.fresh,
      customer: WalkInCustomerDraft(
        type: 'INDIVIDUAL',
        legalName: 'Maria Souza',
        documentNumber: '529.982.247-25',
        phone: '81999998888',
      ),
    );

    test('manda os dados do cliente e nada de identificador', () {
      final corpo = rascunho.toJson();
      final cliente = corpo['customer'] as Map<String, dynamic>;

      expect(corpo.containsKey('customerId'), isFalse);
      expect(cliente['type'], 'INDIVIDUAL');
      expect(cliente['legalName'], 'Maria Souza');
      expect(cliente['documentNumber'], '529.982.247-25');
    });

    test('nome em branco não está pronto', () {
      const semNome = WalkInDraft(
        origin: WalkInOrigin.fresh,
        customer: WalkInCustomerDraft(type: 'COMPANY', legalName: '  '),
      );

      expect(semNome.isReady, isFalse);
      expect(semNome.blockedReason, 'Informe ao menos o nome do cliente.');
    });

    /// Campo em branco não viaja: `''` sobrescreveria o cadastro com nada.
    test('campo vazio não entra no corpo', () {
      const comVazios = WalkInDraft(
        origin: WalkInOrigin.fresh,
        customer: WalkInCustomerDraft(
          type: 'COMPANY',
          legalName: 'Clima Norte',
          tradeName: '   ',
          email: '',
        ),
      );

      final cliente = comVazios.toJson()['customer'] as Map<String, dynamic>;

      expect(cliente.containsKey('tradeName'), isFalse);
      expect(cliente.containsKey('email'), isFalse);
    });

    /// Ids de equipamento da carteira não fazem sentido para cliente que
    /// nasce agora: ele não tem parque cadastrado.
    test('ids de equipamento não viajam com cliente novo', () {
      const comIds = WalkInDraft(
        origin: WalkInOrigin.fresh,
        customer: WalkInCustomerDraft(
          type: 'COMPANY',
          legalName: 'Clima Norte',
        ),
        assetIds: ['asset-de-outro-cliente'],
      );

      expect(comIds.toJson().containsKey('assetIds'), isFalse);
    });
  });

  group('endereço', () {
    test('endereço com rua e cidade viaja', () {
      const rascunho = WalkInDraft(
        origin: WalkInOrigin.fresh,
        customer: WalkInCustomerDraft(
          type: 'COMPANY',
          legalName: 'Clima Norte',
          address: WalkInAddressDraft(
            postalCode: '50030-230',
            street: 'Avenida Rio Branco',
            number: '120',
            city: 'Recife',
            stateCode: 'PE',
            reference: 'Portão azul ao lado da padaria',
          ),
        ),
      );

      final cliente = rascunho.toJson()['customer'] as Map<String, dynamic>;
      final endereco = cliente['address'] as Map<String, dynamic>;

      expect(endereco['street'], 'Avenida Rio Branco');
      expect(endereco['reference'], 'Portão azul ao lado da padaria');
    });

    /// Endereço totalmente vazio não viaja.
    ///
    /// Sem este corte, o cliente nasceria com um objeto de endereço vazio — e a
    /// aba Endereços mostraria uma linha que não diz onde é.
    test('endereço sem nada preenchido não entra no corpo', () {
      const rascunho = WalkInDraft(
        origin: WalkInOrigin.fresh,
        customer: WalkInCustomerDraft(
          type: 'COMPANY',
          legalName: 'Clima Norte',
          address: WalkInAddressDraft(),
        ),
      );

      final cliente = rascunho.toJson()['customer'] as Map<String, dynamic>;

      expect(cliente.containsKey('address'), isFalse);
    });

    test('só o ponto de referência já é endereço que vale enviar', () {
      /// Em campo é o que localiza: "casa amarela depois do posto" leva o
      /// próximo técnico melhor que um CEP de rua comprida.
      const endereco = WalkInAddressDraft(reference: 'Casa amarela');

      expect(endereco.hasAnything, isTrue);
    });
  });

  group('equipamentos identificados na hora', () {
    test('equipamento sem nome é descartado', () {
      const rascunho = WalkInDraft(
        origin: WalkInOrigin.fresh,
        customer: WalkInCustomerDraft(
          type: 'COMPANY',
          legalName: 'Clima Norte',
        ),
        equipment: [
          WalkInEquipmentDraft(name: '   '),
          WalkInEquipmentDraft(name: 'Split do quarto'),
        ],
      );

      final equipamentos = rascunho.toJson()['equipment'] as List<dynamic>;

      expect(equipamentos, hasLength(1));
      expect(
        (equipamentos.first as Map<String, dynamic>)['name'],
        'Split do quarto',
      );
    });

    /// Nenhum equipamento é legítimo.
    ///
    /// "Fui olhar e o problema é a rede elétrica" é um atendimento real, e
    /// exigir um aparelho aqui o travaria.
    test('sem equipamento nenhum, continua pronto', () {
      const rascunho = WalkInDraft(
        origin: WalkInOrigin.existing,
        customerId: 'cliente-1',
      );

      expect(rascunho.isReady, isTrue);
      expect(rascunho.toJson().containsKey('equipment'), isFalse);
    });

    test('só o nome basta para o aparelho viajar', () {
      const equipamento = WalkInEquipmentDraft(name: 'Split da recepção');

      expect(equipamento.isUsable, isTrue);
      expect(equipamento.toJson(), {'name': 'Split da recepção'});
    });
  });

  group('dados do atendimento', () {
    test('a natureza padrão é manutenção', () {
      const rascunho = WalkInDraft(
        origin: WalkInOrigin.existing,
        customerId: 'cliente-1',
      );

      expect(rascunho.toJson()['kind'], 'MAINTENANCE');
    });

    test('título em branco não viaja: o servidor compõe', () {
      const rascunho = WalkInDraft(
        origin: WalkInOrigin.existing,
        customerId: 'cliente-1',
        title: '   ',
      );

      expect(rascunho.toJson().containsKey('title'), isFalse);
    });

    test('o que foi preenchido viaja', () {
      const rascunho = WalkInDraft(
        origin: WalkInOrigin.existing,
        customerId: 'cliente-1',
        kind: 'INSPECTION',
        title: 'Vistoria de pré-instalação',
        description: 'Cliente quer avaliar ponto elétrico',
        priority: 'HIGH',
        sector: 'Recepção',
      );

      expect(rascunho.toJson(), {
        'customerId': 'cliente-1',
        'kind': 'INSPECTION',
        'title': 'Vistoria de pré-instalação',
        'description': 'Cliente quer avaliar ponto elétrico',
        'priority': 'HIGH',
        'sector': 'Recepção',
      });
    });
  });
}
