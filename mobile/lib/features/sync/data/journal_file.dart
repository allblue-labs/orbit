/// O arquivo por trás do journal.
///
/// Escrita **atômica**: grava num temporário e renomeia por cima. `rename(2)`
/// é atômico dentro do mesmo sistema de arquivos, então um corte de energia no
/// meio deixa o journal anterior intacto em vez de um arquivo truncado. Sem
/// isso, o modo de falha seria o pior possível — perder a fila justamente no
/// momento em que ela é a única cópia do trabalho.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

abstract interface class JournalFile {
  Future<String?> read();
  Future<void> write(String contents);
  Future<void> delete();
}

class DocumentsJournalFile implements JournalFile {
  DocumentsJournalFile({required this.name});

  final String name;
  File? _resolved;

  Future<File> _file() async {
    final cached = _resolved;
    if (cached != null) return cached;
    final directory = Directory(
      '${(await getApplicationDocumentsDirectory()).path}/orbit',
    );
    if (!await directory.exists()) await directory.create(recursive: true);
    return _resolved = File('${directory.path}/$name');
  }

  @override
  Future<String?> read() async {
    final file = await _file();
    if (!await file.exists()) return null;
    return file.readAsString(encoding: utf8);
  }

  @override
  Future<void> write(String contents) async {
    final file = await _file();
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsString(contents, encoding: utf8, flush: true);
    await temporary.rename(file.path);
  }

  @override
  Future<void> delete() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

/// Journal em memória — para teste, e só.
class MemoryJournalFile implements JournalFile {
  String? _contents;

  @override
  Future<String?> read() async => _contents;

  @override
  Future<void> write(String contents) async => _contents = contents;

  @override
  Future<void> delete() async => _contents = null;
}
