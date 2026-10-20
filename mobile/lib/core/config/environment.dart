/// Configuração de ambiente.
///
/// Os valores chegam por `--dart-define-from-file`; presets não secretos vivem
/// em `config/`, enquanto arquivos específicos da máquina ficam ignorados.
///
/// ```sh
/// flutter run --dart-define-from-file=config/development.android.json
/// flutter build appbundle --release --dart-define-from-file=config/production.json
/// ```
library;

import 'package:flutter/foundation.dart' show kReleaseMode;

enum OrbitFlavor { development, staging, production }

class OrbitEnvironment {
  const OrbitEnvironment({
    required this.apiBaseUrl,
    required this.flavor,
    required this.connectTimeout,
    required this.receiveTimeout,
  });

  /// Lê a configuração do processo.
  ///
  /// O padrão aponta para `10.0.2.2`, que é como o emulador Android enxerga o
  /// `localhost` da máquina — o valor mais útil em desenvolvimento.
  ///
  /// A porta é a que o compose **publica** (`API_PORT`), não a `5001` que a
  /// API escuta dentro do container. Apontar para a interna dá "connection
  /// refused" sem nenhuma pista no app.
  factory OrbitEnvironment.fromDefines() {
    const url = String.fromEnvironment(
      'ORBIT_API_URL',
      defaultValue: 'http://10.0.2.2:6001/api/v1',
    );
    const flavorName = String.fromEnvironment(
      'ORBIT_FLAVOR',
      defaultValue: 'development',
    );
    final environment = OrbitEnvironment(
      apiBaseUrl: url,
      flavor: OrbitFlavor.values.firstWhere(
        (value) => value.name == flavorName,
        orElse: () => OrbitFlavor.development,
      ),
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
    );

    /// Segunda barreira, em tempo de execução.
    ///
    /// A primeira é [_GuardaDeDistribuicao], que impede o artefato de existir.
    /// Esta existe para o caso de o endereço chegar por um caminho que o
    /// compilador não vê — e porque uma defesa só é defesa quando não depende
    /// de um único ponto.
    if (kReleaseMode && !environment.isDistributable) {
      throw StateError(unsafeEndpointReason);
    }
    return environment;
  }

  /// URL do NestJS. O app fala direto com a API — o BFF é da aplicação web.
  final String apiBaseUrl;
  final OrbitFlavor flavor;
  final Duration connectTimeout;
  final Duration receiveTimeout;

  bool get isProduction => flavor == OrbitFlavor.production;

  /* ---------------------------------------------------------------- */
  /* Segurança do artefato distribuível                                */
  /* ---------------------------------------------------------------- */

  /// Este endereço é de máquina de desenvolvimento?
  ///
  /// A lista é **explícita**, e não "todo IP privado": implantação enterprise
  /// em rede interna é caso legítimo, e proibir a faixa inteira quebraria um
  /// cliente real para impedir um erro de configuração. O que se bloqueia é o
  /// que só existe em bancada — `10.0.2.2` é a ponte do emulador Android,
  /// `localhost` e os loopbacks são a própria máquina, `.lab` e `.local` são
  /// nomes de laboratório.
  static bool isDevelopmentEndpoint(String url) {
    final host = (Uri.tryParse(url)?.host ?? '').toLowerCase();
    if (host.isEmpty) return true;

    const bancada = {
      '10.0.2.2', // ponte do emulador Android para o host
      '10.0.3.2', // idem, Genymotion
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
    };
    if (bancada.contains(host)) return true;
    return host.endsWith('.lab') ||
        host.endsWith('.local') ||
        host.endsWith('.localhost') ||
        host.endsWith('.test') ||
        host.endsWith('.invalid');
  }

  /// O artefato pode ser distribuído com esta configuração?
  ///
  /// Olha o **endereço efetivo**, não o nome do sabor. `ORBIT_FLAVOR=production`
  /// apontando para `10.0.2.2` continua sendo um binário que fala com a
  /// bancada de alguém — e um sabor é uma string que qualquer script de build
  /// pode preencher errado sem que nada reclame.
  bool get isDistributable => !isDevelopmentEndpoint(apiBaseUrl);

  /// Por que a configuração não serve para distribuir.
  ///
  /// Sem o endereço: esta frase pode acabar num log de CI público, e a razão
  /// não depende de mostrar para onde se apontou.
  static const unsafeEndpointReason =
      'A configuração aponta para um endereço de desenvolvimento. '
      'Defina ORBIT_API_URL no arquivo de configuração do ambiente de destino.';

  /// O destino, como `host:porta`.
  ///
  /// Responde "para onde tentei ir" quando a conexão falha — quase sempre a
  /// URL é a errada, não a rede. Este dado é de **log**, não de tela.
  String get apiHost {
    final uri = Uri.tryParse(apiBaseUrl);
    if (uri == null || uri.host.isEmpty) return apiBaseUrl;
    return uri.hasPort ? '${uri.host}:${uri.port}' : uri.host;
  }

  /// O endereço, para o **diagnóstico** — nunca para a tela.
  ///
  /// Antes este campo era `null` em produção, porque o endereço era
  /// concatenado na mensagem pública e o ambiente era a única barreira. Hoje
  /// ele nunca chega à apresentação: vai para [OrbitDiagnostics], que a
  /// interface não recebe. Por isso pode existir em todo ambiente — quem
  /// investiga um erro em produção precisa dele tanto quanto em bancada.
  String get diagnosticHost => apiHost;

  /// Cliente informado ao backend em `LoginDto.client`.
  static const String client = 'MOBILE';
}

/* ------------------------------------------------------------------ */
/* A barreira que impede o artefato de existir                         */
/* ------------------------------------------------------------------ */

/// O endereço, **como foi informado**. Vazio quando ninguém informou.
///
/// Sem `defaultValue` de propósito: é a ausência que interessa aqui. O padrão
/// local continua existindo em [OrbitEnvironment.fromDefines], onde serve.
const _urlInformada = String.fromEnvironment('ORBIT_API_URL');

/// Estamos compilando para distribuição?
///
/// `dart.vm.product` é ligado pelo compilador em `--release`. Ao contrário de
/// `ORBIT_FLAVOR`, nenhum script de build o preenche errado — não é um
/// `--dart-define` que alguém possa escrever à mão.
const _compilandoParaDistribuicao = bool.fromEnvironment('dart.vm.product');

/// Os endereços de bancada mais comuns, escritos por extenso.
///
/// ## Por que uma lista literal, e não a mesma função do runtime
///
/// A avaliação constante do Dart não chama métodos: `contains`, `Uri.parse` e
/// `toLowerCase` não existem aqui. Só `==`, `&&`, `||` e `!`. A verificação
/// completa — por host, com sufixos e maiúsculas — mora em
/// [OrbitEnvironment.isDevelopmentEndpoint] e roda na abertura.
///
/// Esta lista cobre o que de fato acontece: o padrão do repositório e as
/// variações que alguém digita ao compilar da própria máquina. Não é a regra
/// inteira, e não pretende ser — é a metade da defesa que consegue impedir o
/// **artefato de existir**, que é onde o estrago é maior.
const _ehBancadaConhecida =
    _urlInformada == 'http://10.0.2.2:6001/api/v1' ||
    _urlInformada == 'http://10.0.2.2:6001' ||
    _urlInformada == 'http://10.0.3.2:6001/api/v1' ||
    _urlInformada == 'http://localhost:6001/api/v1' ||
    _urlInformada == 'http://localhost:6001' ||
    _urlInformada == 'http://localhost:5001/api/v1' ||
    _urlInformada == 'http://127.0.0.1:6001/api/v1' ||
    _urlInformada == 'http://127.0.0.1:6001' ||
    _urlInformada == 'http://0.0.0.0:6001/api/v1' ||
    _urlInformada == 'https://api.production.invalid/api/v1';

/// Um build de distribuição precisa de endereço informado e não-local.
///
/// A ausência conta como insegura: sem `ORBIT_API_URL`, o aplicativo cairia no
/// padrão do repositório, que é a ponte do emulador.
const _distribuicaoSegura =
    !_compilandoParaDistribuicao ||
    (_urlInformada != '' && !_ehBancadaConhecida);

/// A barreira.
///
/// ## Como ela funciona
///
/// O `assert` de um construtor `const` é avaliado **durante a compilação**. Um
/// `const` que o viola não compila — e sem compilação não há artefato.
///
/// ## Por que não bastava falhar na abertura
///
/// Um aplicativo que compila e morre ao abrir já foi assinado, enviado para a
/// loja e distribuído. O erro aparece na mão de quem instalou, não na esteira
/// de quem publicou. Aqui ele aparece onde deve.
///
/// ## O que fazer quando isto disparar
///
/// ```sh
/// make build-android-prod
/// ```
class _GuardaDeDistribuicao {
  const _GuardaDeDistribuicao(bool seguro)
    : assert(
        seguro,
        'Build de release com endereço de desenvolvimento. O ORBIT_API_URL '
        'informado é um endereço de bancada, ou não foi informado e o padrão '
        'do repositório aponta para a máquina de desenvolvimento. Informe '
        '--dart-define-from-file com o preset do ambiente de destino.',
      );
}

// ignore: unused_element
const _guardaDeDistribuicao = _GuardaDeDistribuicao(_distribuicaoSegura);
