/// Persistência da fila de uploads.
///
/// A fila fica em um arquivo JSON no diretório da aplicação — não em
/// `SharedPreferences`, porque pode crescer e é escrita com frequência, e não
/// no armazenamento seguro, que é exclusivo de tokens.
library;

import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'upload_task.dart';
import 'upload_queue.dart';

class FileUploadQueueStore implements UploadQueueStore {
  FileUploadQueueStore({Directory? directory, String? namespace})
    : _directory = directory,
      _fileName = namespace == null
          ? 'upload_queue.json'
          : 'upload_queue.$namespace.json';

  final String _fileName;

  Directory? _directory;

  Future<File> _file() async {
    final directory = _directory ??= await getApplicationSupportDirectory();
    if (!directory.existsSync()) {
      await directory.create(recursive: true);
    }
    return File('${directory.path}/$_fileName');
  }

  @override
  Future<List<UploadTask>> load() async {
    try {
      final file = await _file();
      if (!file.existsSync()) return const [];
      final decoded = jsonDecode(await file.readAsString());
      if (decoded is! List) return const [];
      return decoded
          .whereType<Map<String, dynamic>>()
          .map(UploadTask.fromJson)
          .toList(growable: false);
    } on Object {
      // Fila corrompida não pode impedir o app de abrir: recomeça vazia.
      return const [];
    }
  }

  @override
  Future<void> save(List<UploadTask> tasks) async {
    final file = await _file();
    await file.writeAsString(
      jsonEncode(tasks.map((task) => task.toJson()).toList()),
      flush: true,
    );
  }
}

/// Diretório onde as cópias das evidências aguardam envio.
///
/// A cópia é necessária: o caminho devolvido pela galeria ou pela câmera pode
/// ser temporário e sumir antes de a fila chegar nele.
Future<Directory> evidenceDirectory() async {
  final base = await getApplicationSupportDirectory();
  final directory = Directory('${base.path}/evidencias');
  if (!directory.existsSync()) await directory.create(recursive: true);
  return directory;
}
