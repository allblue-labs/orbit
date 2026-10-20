/// O que uma mensagem pública nunca pode conter.
///
/// ## Por que isto é um helper de teste, e não um lint
///
/// O analisador do Dart sabe dizer que um `String` é um `String`. Ele não sabe
/// dizer que aquele `String` vai parar num `Text` que um técnico lê de pé numa
/// casa de máquinas. Essa distinção é semântica, e é a que importa aqui.
///
/// Este arquivo é a definição executável do contrato: qualquer teste que
/// produza copy pública passa por [expectSafePublicError], e o corpus abaixo
/// cresce toda vez que alguém descobrir uma forma nova de vazar.
///
/// ## O incidente que originou o guard
///
/// Um técnico abriu o aplicativo e leu:
///
/// ```text
/// O servidor demorou a responder. (tentei 10.0.2.2:6001)
/// ```
///
/// A frase estava certa; o parêntese não. O guard existe para que essa linha
/// não volte por descuido em nenhuma das dezenas de superfícies que mostram
/// erro.
library;

import 'package:flutter_test/flutter_test.dart';

/// Trechos literais que nunca aparecem em texto público.
///
/// Não é uma lista de "coisas feias": cada item é uma categoria de vazamento
/// com consequência própria. Endereço e porta descrevem a topologia; nome de
/// exceção entrega a pilha de tecnologia; `#0` e `package:` são stack trace.
const literaisProibidos = <String>[
  // Endereços de bancada — o incidente original.
  '10.0.2.2',
  '10.0.3.2',
  '127.0.0.1',
  '0.0.0.0',
  'localhost',
  // Portas do ambiente local.
  ':6001',
  ':5001',
  ':3000',
  // Caminho da API.
  '/api/v1',
  // Nomes de biblioteca e de exceção.
  'DioException',
  'DioError',
  'SocketException',
  'HandshakeException',
  'TlsException',
  'CertificateException',
  'TimeoutException',
  'StateError',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'Connection refused',
  'connection timed out',
  'Failed host lookup',
  'CERTIFICATE_VERIFY_FAILED',
  // Vocabulário de infraestrutura.
  'nginx',
  'Bad Gateway',
  'Gateway Timeout',
  'requestOptions',
  'baseUrl',
  'statusMessage',
  // Rastro de pilha.
  '#0',
  'package:',
  'dart:',
];

/// Um IPv4 literal, em qualquer forma.
///
/// O corpus acima pega os endereços conhecidos; este padrão pega o endereço da
/// máquina de quem for rodar amanhã, que ninguém previu.
final _ipv4 = RegExp(r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b');

/// Um endereço com esquema.
final _url = RegExp(r'https?://', caseSensitive: false);

/// `host:porta` — o formato exato do vazamento original.
final _hostPorta = RegExp(
  r'\b[a-z0-9.-]+\.[a-z]{2,}:\d{2,5}\b',
  caseSensitive: false,
);

/// Falha o teste se [texto] contiver qualquer marca de infraestrutura.
///
/// [onde] aparece na mensagem de falha: quando o guard dispara, a primeira
/// pergunta é "em que tela?", e a resposta deve estar ali.
void expectSafePublicError(String texto, {String onde = 'mensagem pública'}) {
  for (final proibido in literaisProibidos) {
    expect(
      texto.contains(proibido),
      isFalse,
      reason:
          'Vazamento de infraestrutura em $onde: encontrou "$proibido".\n'
          'Texto: "$texto"',
    );
  }

  expect(
    _ipv4.hasMatch(texto),
    isFalse,
    reason: 'Endereço IP em $onde.\nTexto: "$texto"',
  );
  expect(
    _url.hasMatch(texto),
    isFalse,
    reason: 'URL em $onde.\nTexto: "$texto"',
  );
  expect(
    _hostPorta.hasMatch(texto),
    isFalse,
    reason: 'Host com porta em $onde.\nTexto: "$texto"',
  );
}

/// O mesmo, para tudo o que uma tela está mostrando.
void expectSafePublicErrorAll(Iterable<String> textos, {String onde = 'tela'}) {
  for (final texto in textos) {
    expectSafePublicError(texto, onde: onde);
  }
}
