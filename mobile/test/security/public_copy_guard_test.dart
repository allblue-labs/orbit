/// Nenhuma frase pública do aplicativo descreve infraestrutura.
///
/// ## O que este teste lê
///
/// O catálogo de copy pública e os literais de texto das camadas de
/// apresentação. **Não** o projeto inteiro: URLs são legítimas em configuração,
/// em documentação e no cliente HTTP, e um guard que reclamasse delas seria
/// desligado na primeira semana.
///
/// A pergunta é sempre a mesma: *isto pode virar um `Text` na tela de alguém?*
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/core/errors/orbit_public_copy.dart';
import 'package:orbit_operator/core/presentation/field_registry.dart';

import 'public_error_guard.dart';

/// Onde mora texto que a pessoa lê.
///
/// Apresentação e catálogos de rótulo. Infraestrutura fica de fora de
/// propósito: é lá que endereço e nome de exceção têm razão de existir.
const _diretoriosDeApresentacao = <String>[
  'lib/features',
  'lib/core/widgets',
  'lib/core/design',
  'lib/core/presentation',
  'lib/core/errors',
];

/// Literais de string de um arquivo Dart, sem os comentários.
///
/// Comentários explicam o incidente e **citam** `10.0.2.2` de propósito — é
/// assim que a próxima pessoa entende por que o código é como é. Guard que
/// reclama de comentário ensina a apagar a explicação.
List<String> literaisDeTexto(String fonte) {
  final semComentarios = fonte
      .split('\n')
      .where((linha) {
        final limpa = linha.trimLeft();
        return !limpa.startsWith('//') && !limpa.startsWith('///');
      })
      .join('\n');

  final aspasSimples = RegExp(r"'((?:[^'\\\n]|\\.)*)'");
  final aspasDuplas = RegExp(r'"((?:[^"\\\n]|\\.)*)"');
  return [
    for (final m in aspasSimples.allMatches(semComentarios)) m.group(1)!,
    for (final m in aspasDuplas.allMatches(semComentarios)) m.group(1)!,
  ];
}

/// Uma string parece uma frase para alguém ler?
///
/// Identificador de rota, chave de mapa e nome de campo também são literais, e
/// nenhum deles vira `Text`. O critério é grosseiro de propósito: tem espaço e
/// tem letra acentuada ou mais de duas palavras — o formato de uma frase em
/// português.
bool pareceFrase(String texto) {
  if (!texto.contains(' ')) return false;
  if (texto.length < 12) return false;

  /// Caminhos e formatos não são frases, mesmo com espaço.
  if (texto.startsWith('/') || texto.startsWith('package:')) return false;
  return true;
}

void main() {
  group('o catálogo de copy pública', () {
    test('nenhuma frase descreve infraestrutura', () {
      const frases = <String, String>{
        'offline': OrbitPublicCopy.offline,
        'timeout': OrbitPublicCopy.timeout,
        'serverUnavailable': OrbitPublicCopy.serverUnavailable,
        'secureConnectionFailed': OrbitPublicCopy.secureConnectionFailed,
        'cancelled': OrbitPublicCopy.cancelled,
        'unknown': OrbitPublicCopy.unknown,
        'loadFailed': OrbitPublicCopy.loadFailed,
        'refreshFailed': OrbitPublicCopy.refreshFailed,
        'resultUnknown': OrbitPublicCopy.resultUnknown,
        'requiresConnection': OrbitPublicCopy.requiresConnection,
      };

      frases.forEach((nome, frase) {
        expectSafePublicError(frase, onde: 'OrbitPublicCopy.$nome');

        /// E é uma frase de verdade, em português, com ponto final.
        expect(frase.trim(), isNotEmpty, reason: nome);
        expect(frase.endsWith('.'), isTrue, reason: '$nome sem ponto final');
      });
    });

    test('o tom não é de susto nem de culpa', () {
      const proibidos = [
        'Ops',
        'Oops',
        'Falha crítica',
        'deu muito errado',
        'Você fez',
        'erro fatal',
      ];
      const todas = [
        OrbitPublicCopy.offline,
        OrbitPublicCopy.timeout,
        OrbitPublicCopy.serverUnavailable,
        OrbitPublicCopy.secureConnectionFailed,
        OrbitPublicCopy.unknown,
        OrbitPublicCopy.loadFailed,
        OrbitPublicCopy.refreshFailed,
        OrbitPublicCopy.resultUnknown,
      ];

      for (final frase in todas) {
        for (final proibido in proibidos) {
          expect(
            frase.toLowerCase().contains(proibido.toLowerCase()),
            isFalse,
            reason: '"$frase" usa "$proibido"',
          );
        }
      }
    });
  });

  group('as frases por status HTTP', () {
    test('nenhuma menciona número de status nem protocolo', () {
      for (final status in [400, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
        final frase = OrbitException.publicCopyForStatus(status);

        expectSafePublicError(frase, onde: 'status $status');
        expect(frase, isNot(contains('$status')));
        expect(frase.toUpperCase(), isNot(contains('HTTP')));
      }
    });

    test('403 não nomeia permissão interna', () {
      final frase = OrbitException.publicCopyForStatus(403);

      /// Um identificador pontuado — `operations.manage`, `assets.read` — é o
      /// vocabulário do RBAC, e não diz nada a quem só queria concluir uma
      /// ordem de serviço. O ponto final da frase, claro, é permitido.
      expect(
        RegExp(r'\b[a-z_]+\.[a-z_]+\b').hasMatch(frase),
        isFalse,
        reason: 'A frase de 403 nomeia uma permissão interna: "$frase"',
      );
      expect(frase.toLowerCase(), isNot(contains('capability')));
      expect(frase.toLowerCase(), isNot(contains('permission')));
    });
  });

  group('os rótulos de código de erro', () {
    test('nenhum descreve infraestrutura', () {
      errorCodeLabels.forEach((codigo, rotulo) {
        expectSafePublicError(rotulo, onde: 'errorCodeLabels[$codigo]');
      });
    });
  });

  group('as camadas de apresentação', () {
    test('nenhum literal de frase carrega endereço ou nome de exceção', () {
      final problemas = <String>[];

      for (final diretorio in _diretoriosDeApresentacao) {
        final raiz = Directory(diretorio);
        if (!raiz.existsSync()) continue;

        for (final arquivo
            in raiz
                .listSync(recursive: true)
                .whereType<File>()
                .where((f) => f.path.endsWith('.dart'))) {
          for (final literal in literaisDeTexto(arquivo.readAsStringSync())) {
            if (!pareceFrase(literal)) continue;
            for (final proibido in literaisProibidos) {
              if (literal.contains(proibido)) {
                problemas.add('${arquivo.path}: "$literal" contém "$proibido"');
              }
            }
          }
        }
      }

      expect(
        problemas,
        isEmpty,
        reason:
            'Frases de apresentação com marca de infraestrutura:\n'
            '${problemas.join('\n')}',
      );
    });

    test('nenhuma camada de apresentação importa Dio', () {
      final ofensores = <String>[];

      for (final diretorio in _diretoriosDeApresentacao) {
        final raiz = Directory(diretorio);
        if (!raiz.existsSync()) continue;

        for (final arquivo
            in raiz
                .listSync(recursive: true)
                .whereType<File>()
                .where((f) => f.path.endsWith('.dart'))) {
          if (arquivo.readAsStringSync().contains("package:dio")) {
            ofensores.add(arquivo.path);
          }
        }
      }

      expect(
        ofensores,
        isEmpty,
        reason:
            'Dio é detalhe de transporte. Estes arquivos o importam e podem '
            'expor mensagem de biblioteca:\n${ofensores.join('\n')}',
      );
    });
    test('nenhuma tela interpola o objeto de erro no texto', () {
      /// `Text('falhou: $error')` é o vazamento pela porta dos fundos.
      ///
      /// O objeto vira texto pelo `toString()`, e o `toString()` de
      /// `SocketException` carrega endereço e porta — exatamente o incidente,
      /// escrito por uma tela em vez de pelo interceptor. A busca é pelo
      /// **nome da variável** interpolado, que é como o padrão aparece na
      /// prática: `$error`, `$erro`, `$e`, `$err`, `$exception`.
      final interpolacao = RegExp(
        r'\$\{?(error|erro|err|exception|excecao|e)\}?(?![A-Za-z0-9_.])',
      );

      final ofensores = <String>[];

      for (final diretorio in _diretoriosDeApresentacao) {
        final raiz = Directory(diretorio);
        if (!raiz.existsSync()) continue;

        for (final arquivo
            in raiz
                .listSync(recursive: true)
                .whereType<File>()
                .where((f) => f.path.endsWith('.dart'))) {
          for (final literal in literaisDeTexto(arquivo.readAsStringSync())) {
            if (interpolacao.hasMatch(literal)) {
              ofensores.add('${arquivo.path}: "$literal"');
            }
          }
        }
      }

      expect(
        ofensores,
        isEmpty,
        reason:
            'Estes textos interpolam o objeto de erro. Use '
            'OrbitException.publicCopyForAny:\n${ofensores.join('\n')}',
      );
    });

    test('publicCopyForAny nunca devolve o toString do erro', () {
      final entradas = <Object>[
        const SocketException('Connection refused', address: null),
        StateError('http://10.0.2.2:6001/api/v1 caiu'),
        const FormatException('unexpected token'),
        Exception('boom em 192.168.1.233:6001'),
        'uma string qualquer',
      ];

      for (final entrada in entradas) {
        expectSafePublicError(
          OrbitException.publicCopyForAny(entrada),
          onde: 'publicCopyForAny(${entrada.runtimeType})',
        );
        expectSafePublicError(
          OrbitException.publicCopyForAny(entrada, prefixo: 'Não deu.'),
          onde: 'publicCopyForAny com prefixo',
        );
      }

      /// E, quando o erro é do Orbit, é a copy dele que sai — não o genérico.
      expect(
        OrbitException.publicCopyForAny(
          const OrbitException(
            kind: OrbitErrorKind.timeout,
            publicMessage: OrbitPublicCopy.timeout,
          ),
        ),
        OrbitPublicCopy.timeout,
      );
    });
  });
}
