/// O artefato distribuível não fala com a bancada de ninguém.
///
/// ## O problema
///
/// O padrão de `ORBIT_API_URL` é `http://10.0.2.2:6001/api/v1` — a ponte do
/// emulador Android — e o de `ORBIT_FLAVOR` é `development`. Um
/// `flutter build apk --release` sem `--dart-define` produzia um binário
/// apontando para a máquina de quem compilou, **e** com o antigo guarda de
/// mensagem desligado, porque ele dependia do sabor.
///
/// Isso é pior do que o vazamento de texto: um aplicativo distribuído que
/// tenta falar com `10.0.2.2` não funciona para ninguém, e num cenário menos
/// inocente falaria com um endereço que o atacante controla.
///
/// ## A escolha
///
/// O padrão local **não foi removido**: é o que serve em desenvolvimento, e
/// tirá-lo para o teste passar seria maquiar o problema. O que existe é uma
/// barreira no ponto de compilação: em `release`, endereço de bancada aborta.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/config/environment.dart';

OrbitEnvironment ambiente(String url, OrbitFlavor flavor) => OrbitEnvironment(
  apiBaseUrl: url,
  flavor: flavor,
  connectTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 30),
);

void main() {
  group('endereços de bancada', () {
    const bancada = [
      'http://10.0.2.2:6001/api/v1', // o do incidente
      'http://10.0.3.2:6001/api/v1',
      'http://localhost:6001/api/v1',
      'http://127.0.0.1:6001/api/v1',
      'http://0.0.0.0:6001/api/v1',
      'https://orbit.lab/api/v1',
      'https://api.orbit.local/api/v1',
      'http://orbit.test/api/v1',
    ];

    for (final url in bancada) {
      test('reconhece $url', () {
        expect(OrbitEnvironment.isDevelopmentEndpoint(url), isTrue);
        expect(ambiente(url, OrbitFlavor.development).isDistributable, isFalse);
      });
    }

    test('URL vazia ou ilegível não é distribuível', () {
      expect(OrbitEnvironment.isDevelopmentEndpoint(''), isTrue);
      expect(OrbitEnvironment.isDevelopmentEndpoint('nao-e-url'), isTrue);
    });
  });

  group('endereços legítimos', () {
    const legitimos = [
      'https://api.orbit.app/api/v1',
      'https://orbit.cliente.com.br/api/v1',
      // Implantação em rede interna é caso real de enterprise: proibir a
      // faixa privada inteira quebraria um cliente para impedir um engano.
      'https://192.168.10.20/api/v1',
      'https://10.20.30.40:8443/api/v1',
    ];

    for (final url in legitimos) {
      test('aceita $url', () {
        expect(OrbitEnvironment.isDevelopmentEndpoint(url), isFalse);
        expect(ambiente(url, OrbitFlavor.production).isDistributable, isTrue);
      });
    }
  });

  group('o sabor não compra a permissão', () {
    test('ORBIT_FLAVOR=production com endereço local continua bloqueado', () {
      /// O caso que um script de build errado produz: alguém "corrige" o
      /// sabor e esquece a URL. O sabor é uma string; o endereço é o fato.
      final ambienteMentiroso = ambiente(
        'http://10.0.2.2:6001/api/v1',
        OrbitFlavor.production,
      );

      expect(ambienteMentiroso.isProduction, isTrue);
      expect(ambienteMentiroso.isDistributable, isFalse);
    });

    test('staging com endereço real é distribuível', () {
      expect(
        ambiente(
          'https://staging.orbit.app/api/v1',
          OrbitFlavor.staging,
        ).isDistributable,
        isTrue,
      );
    });
  });

  group('desenvolvimento continua funcionando', () {
    test('o padrão local permanece disponível fora de release', () {
      /// O teste roda em modo de teste, não em release: a leitura do processo
      /// devolve o padrão local sem abortar, que é o que a bancada precisa.
      final atual = OrbitEnvironment.fromDefines();

      expect(atual.apiBaseUrl, isNotEmpty);
      expect(atual.flavor, isA<OrbitFlavor>());
    });
  });

  group('as duas camadas concordam', () {
    /// A barreira de compilação compara strings literais, porque a avaliação
    /// constante do Dart não chama métodos. A de execução usa a regra
    /// completa. Duas implementações da mesma ideia divergem em silêncio se
    /// ninguém as confrontar — este teste confronta.
    const literaisDaBarreiraDeCompilacao = [
      'http://10.0.2.2:6001/api/v1',
      'http://10.0.2.2:6001',
      'http://10.0.3.2:6001/api/v1',
      'http://localhost:6001/api/v1',
      'http://localhost:6001',
      'http://localhost:5001/api/v1',
      'http://127.0.0.1:6001/api/v1',
      'http://127.0.0.1:6001',
      'http://0.0.0.0:6001/api/v1',
    ];

    for (final url in literaisDaBarreiraDeCompilacao) {
      test('a regra de execução também recusa $url', () {
        expect(
          OrbitEnvironment.isDevelopmentEndpoint(url),
          isTrue,
          reason:
              'A barreira de compilação bloqueia este endereço; a de execução '
              'precisa bloquear também, senão as duas contam histórias '
              'diferentes sobre o mesmo build.',
        );
      });
    }

    test('o padrão do repositório está entre os literais bloqueados', () {
      /// Se alguém mudar o padrão sem atualizar a barreira, um release sem
      /// configuração voltaria a compilar. Este teste é o alarme.
      const padraoDoRepositorio = 'http://10.0.2.2:6001/api/v1';

      expect(literaisDaBarreiraDeCompilacao, contains(padraoDoRepositorio));
      expect(
        OrbitEnvironment.fromDefines().apiBaseUrl,
        padraoDoRepositorio,
        reason:
            'O padrão mudou. Atualize os literais da barreira de compilação '
            'em environment.dart.',
      );
    });
  });

  group('a razão da recusa', () {
    test('explica o que fazer e não mostra o endereço', () {
      final razao = OrbitEnvironment.unsafeEndpointReason;

      expect(razao, contains('ORBIT_API_URL'));
      expect(razao, isNot(contains('10.0.2.2')));
      expect(razao, isNot(contains('localhost')));
    });
  });
}
