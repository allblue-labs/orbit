/// Persistência da fila de uploads.
///
/// A fila fica em um arquivo JSON no diretório da aplicação — não em
/// `SharedPreferences`, porque pode crescer e é escrita com frequência, e não
/// no armazenamento seguro, que é exclusivo de tokens.
library;

import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:crypto/crypto.dart';

import '../storage/offline_data.dart';
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
  Future<void> _writing = Future.value();

  Future<void> _preserve(File file, String raw) async {
    final digest = sha256.convert(utf8.encode(raw));
    final archive = File('${file.path}.recovery.$digest');
    if (await archive.exists()) return;
    await OfflineDataFile(
      archive,
      scope: 'upload-recovery',
    ).write(utf8.encode(raw));
  }

  Future<File> _file() async {
    final directory = _directory ??= await getApplicationSupportDirectory();
    if (!directory.existsSync()) {
      await directory.create(recursive: true);
    }
    return File('${directory.path}/$_fileName');
  }

  @override
  Future<List<UploadTask>> load() async {
    final file = await _file();
    final bytes = await OfflineDataFile(file, scope: 'upload-queue').read();
    if (bytes == null) return const [];
    final raw = utf8.decode(bytes);
    Object? decoded;
    try {
      decoded = jsonDecode(raw);
    } on Object {
      await _preserve(file, raw);
      return const [];
    }
    if (decoded is! List) {
      await _preserve(file, raw);
      return const [];
    }
    final tasks = <UploadTask>[];
    var invalid = false;
    for (final entry in decoded) {
      try {
        tasks.add(UploadTask.fromJson(Map<String, dynamic>.from(entry as Map)));
      } on Object {
        invalid = true;
      }
    }
    if (invalid) await _preserve(file, raw);
    return tasks;
  }

  @override
  Future<void> save(List<UploadTask> tasks) {
    final next = _writing.then((_) async {
      // Mesmo um save anterior ao restore deve preservar o arquivo ilegível.
      await load();
      final file = await _file();
      await OfflineDataFile(file, scope: 'upload-queue').write(
        utf8.encode(jsonEncode(tasks.map((task) => task.toJson()).toList())),
      );
    });
    _writing = next.then((_) {}, onError: (Object _) {});
    return next;
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
