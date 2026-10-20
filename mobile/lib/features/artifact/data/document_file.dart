/// O arquivo do documento, no aparelho.
///
/// **Temporário de propósito.** O documento é do servidor; guardá-lo
/// indefinidamente criaria uma cópia que envelhece sozinha e que ninguém
/// revoga quando o acesso da pessoa muda. O app baixa para abrir ou
/// compartilhar, e limpa depois.
library;

import 'dart:io';
import 'dart:typed_data';

import 'package:path_provider/path_provider.dart';

import '../../../core/media/media_type.dart';

/// O que impede tratar estes bytes como documento.
enum DocumentFileProblem { empty, notPdf }

/// Confere que o que chegou é mesmo um PDF.
///
/// **Os primeiros bytes decidem.** O `Content-Type` não serve como prova: o
/// storage do Orbit devolve `application/octet-stream` para um PDF legítimo, e
/// um proxy mal configurado devolve uma página de erro com status 200 e o
/// cabeçalho certo. Um cabeçalho é o que o servidor *diz*; a assinatura do
/// arquivo é o que ele *é*.
DocumentFileProblem? checkDocumentBytes(List<int> bytes) {
  if (bytes.isEmpty) return DocumentFileProblem.empty;
  return detectMimeType(Uint8List.fromList(bytes)) == 'application/pdf'
      ? null
      : DocumentFileProblem.notPdf;
}

/// Um nome de arquivo legível para quem recebe.
///
/// O contrato mobile **não** publica `filename`, então ele é construído a
/// partir do que é publicado. Nunca do `artifactId`: um identificador opaco
/// como nome de anexo é inútil para a pessoa que vai abrir o e-mail.
String documentFileName({
  required String documentType,
  required int snapshotVersion,
  String? reference,
}) {
  final safe = (reference ?? documentType)
      .replaceAll(RegExp(r'[^A-Za-z0-9._-]+'), '-')
      /// Pontos consecutivos são o padrão de travessia de diretório. O nome é
      /// concatenado num caminho, então `..` precisa deixar de existir — um
      /// ponto isolado no meio do nome é legítimo e sobrevive.
      .replaceAll(RegExp(r'\.{2,}'), '.')
      .replaceAll(RegExp(r'-+'), '-')
      .replaceAll(RegExp(r'^[-.]+|[-.]+$'), '');
  final base = safe.isEmpty ? 'documento' : safe;
  return '$base-v$snapshotVersion.pdf';
}

abstract interface class DocumentFileStore {
  Future<String> write(String fileName, List<int> bytes);
  Future<bool> exists(String path);
  Future<void> delete(String path);

  /// Apaga o que sobrou de aberturas anteriores.
  Future<void> purge();
}

class TemporaryDocumentFileStore implements DocumentFileStore {
  Directory? _directory;

  Future<Directory> _dir() async {
    final cached = _directory;
    if (cached != null) return cached;
    final directory = Directory(
      '${(await getTemporaryDirectory()).path}/orbit-documentos',
    );
    if (!await directory.exists()) await directory.create(recursive: true);
    return _directory = directory;
  }

  @override
  Future<String> write(String fileName, List<int> bytes) async {
    final directory = await _dir();
    final file = File('${directory.path}/$fileName');

    /// Temporário e rename, como no resto do app: um PDF pela metade no lugar
    /// do definitivo abriria como arquivo corrompido.
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsBytes(bytes, flush: true);
    await temporary.rename(file.path);
    return file.path;
  }

  @override
  Future<bool> exists(String path) => File(path).exists();

  @override
  Future<void> delete(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  @override
  Future<void> purge() async {
    final directory = await _dir();
    if (!await directory.exists()) return;
    await for (final entity in directory.list()) {
      if (entity is File) await entity.delete();
    }
  }
}

/// Armazenamento em memória — para teste, e só.
class MemoryDocumentFileStore implements DocumentFileStore {
  final files = <String, List<int>>{};

  @override
  Future<String> write(String fileName, List<int> bytes) async {
    final path = '/temporario/$fileName';
    files[path] = bytes;
    return path;
  }

  @override
  Future<bool> exists(String path) async => files.containsKey(path);

  @override
  Future<void> delete(String path) async => files.remove(path);

  @override
  Future<void> purge() async => files.clear();
}
