/// A fila de mídia e os arquivos que ela referencia.
///
/// **Não é o journal de comandos.** Aquele guarda intenções semânticas, com
/// envelope, versão e replay; este guarda bytes e o caminho deles. Misturar os
/// dois colocaria megabytes num arquivo reescrito a cada toque de checklist —
/// e faria um full resync de estado ameaçar a foto que ninguém enviou ainda.
///
/// ```text
/// media_queue.json     metadados, escrita atômica
/// media/<id>.<ext>     os bytes, no diretório do app
/// ```
library;

import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:path_provider/path_provider.dart';

import '../../sync/data/command_journal.dart' show CommandScope;
import '../../sync/data/journal_file.dart';
import 'local_media.dart';

/// Onde os arquivos ficam.
///
/// Abstraído para que o teste não precise de um sistema de arquivos real, e
/// para que a origem (câmera, galeria, seletor) nunca dite o destino: o cache
/// do seletor é limpo pelo sistema quando quer, e é exatamente ali que uma
/// foto pendente não pode morar.
abstract interface class MediaFileStore {
  Future<String> persist(
    String localMediaId,
    String extension,
    List<int> bytes,
  );
  Future<Uint8List?> read(String path);
  Future<bool> exists(String path);
  Future<void> delete(String path);
}

class DocumentsMediaFileStore implements MediaFileStore {
  Directory? _directory;

  Future<Directory> _dir() async {
    final cached = _directory;
    if (cached != null) return cached;
    final directory = Directory(
      '${(await getApplicationDocumentsDirectory()).path}/orbit/media',
    );
    if (!await directory.exists()) await directory.create(recursive: true);
    return _directory = directory;
  }

  @override
  Future<String> persist(
    String localMediaId,
    String extension,
    List<int> bytes,
  ) async {
    final directory = await _dir();
    final file = File('${directory.path}/$localMediaId$extension');

    /// Grava num temporário e renomeia: um arquivo pela metade no lugar do
    /// definitivo seria uma evidência corrompida que só falharia no envio.
    final temporary = File('${file.path}.tmp');
    await temporary.writeAsBytes(bytes, flush: true);
    await temporary.rename(file.path);
    return file.path;
  }

  @override
  Future<Uint8List?> read(String path) async {
    final file = File(path);
    return await file.exists() ? file.readAsBytes() : null;
  }

  @override
  Future<bool> exists(String path) => File(path).exists();

  @override
  Future<void> delete(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }
}

/// Armazenamento em memória — para teste, e só.
class MemoryMediaFileStore implements MediaFileStore {
  final files = <String, Uint8List>{};

  @override
  Future<String> persist(
    String localMediaId,
    String extension,
    List<int> bytes,
  ) async {
    final path = '/memoria/$localMediaId$extension';
    files[path] = Uint8List.fromList(bytes);
    return path;
  }

  @override
  Future<Uint8List?> read(String path) async => files[path];

  @override
  Future<bool> exists(String path) async => files.containsKey(path);

  @override
  Future<void> delete(String path) async => files.remove(path);
}

/// O SHA-256 dos bytes, em streaming.
///
/// Sobre os bytes **finais**: calcular antes de qualquer transformação e
/// enviar um arquivo diferente faria o servidor recusar por divergência — e
/// estaria certo em recusar.
Future<String> sha256OfFile(File file) async {
  final digest = await file.openRead().transform(sha256).first;
  return digest.toString();
}

String sha256OfBytes(List<int> bytes) => sha256.convert(bytes).toString();

/// A extensão que corresponde ao tipo real.
String extensionForMime(String mimeType) => switch (mimeType) {
  'image/png' => '.png',
  'image/jpeg' => '.jpg',
  'image/webp' => '.webp',
  'application/pdf' => '.pdf',
  _ => '.bin',
};

final class MediaQueueSnapshot {
  const MediaQueueSnapshot({this.media = const []});

  final List<LocalMedia> media;

  Map<String, Object?> toJson() => {
    'version': 1,
    'media': media.map((value) => value.toJson()).toList(),
  };

  factory MediaQueueSnapshot.fromJson(Map<String, Object?> json) =>
      MediaQueueSnapshot(
        media: (json['media'] as List<Object?>? ?? const [])
            .map(
              (value) => LocalMedia.fromJson(
                Map<String, Object?>.from(value! as Map<Object?, Object?>),
              ),
            )
            .toList(),
      );
}

/// A fila, com escrita serializada.
class MediaQueue {
  MediaQueue({required JournalFile file, required MediaFileStore files})
    : _file = file,
      _files = files;

  final JournalFile _file;
  final MediaFileStore _files;

  MediaQueueSnapshot? _cache;
  Future<void> _tail = Future.value();

  MediaFileStore get files => _files;

  Future<MediaQueueSnapshot> read() async {
    final cached = _cache;
    if (cached != null) return cached;
    final raw = await _file.read();
    if (raw == null || raw.isEmpty) return _cache = const MediaQueueSnapshot();
    try {
      return _cache = MediaQueueSnapshot.fromJson(
        Map<String, Object?>.from(jsonDecode(raw) as Map<Object?, Object?>),
      );
    } on Object {
      /// Metadados ilegíveis: os arquivos continuam no disco, mas sem registro
      /// o app não sabe a que atendimento pertencem. Recomeça vazio em vez de
      /// travar na abertura; a varredura de órfãos cuida do resto.
      await _file.write(jsonEncode(const MediaQueueSnapshot().toJson()));
      return _cache = const MediaQueueSnapshot();
    }
  }

  Future<MediaQueueSnapshot> update(
    MediaQueueSnapshot Function(MediaQueueSnapshot current) change,
  ) {
    final completer = _tail.then((_) async {
      final next = change(await read());
      await _file.write(jsonEncode(next.toJson()));
      return _cache = next;
    });
    _tail = completer.then((_) {}, onError: (_) {});
    return completer;
  }

  /// Registra a mídia. Só depois disto ela existe para o app.
  Future<MediaQueueSnapshot> enqueue(LocalMedia media) =>
      update((current) => MediaQueueSnapshot(media: [...current.media, media]));

  Future<MediaQueueSnapshot> mark(
    String localMediaId,
    LocalMedia Function(LocalMedia current) change,
  ) => update(
    (current) => MediaQueueSnapshot(
      media: current.media
          .map(
            (value) =>
                value.localMediaId == localMediaId ? change(value) : value,
          )
          .toList(),
    ),
  );

  /// Remove o registro **e** o arquivo.
  ///
  /// Usado quando a evidência já existe no servidor, ou quando a pessoa
  /// descarta uma captura que o servidor não aceitou. Nunca antes da
  /// confirmação: o arquivo local é a única cópia.
  Future<MediaQueueSnapshot> remove(String localMediaId) async {
    final current = await read();
    final target = current.media
        .where((value) => value.localMediaId == localMediaId)
        .firstOrNull;
    if (target != null) await _files.delete(target.path);
    return update(
      (snapshot) => MediaQueueSnapshot(
        media: snapshot.media
            .where((value) => value.localMediaId != localMediaId)
            .toList(),
      ),
    );
  }

  /// Marca as mídias cujo arquivo sumiu.
  ///
  /// Tentar enviar um arquivo que não existe produziria falhas em laço sem
  /// nunca dizer o motivo. `missing` é um estado honesto: a pessoa vê que
  /// aquela captura se perdeu, em vez de vê-la "aguardando envio" para sempre.
  Future<MediaQueueSnapshot> detectOrphans() async {
    final current = await read();
    final gone = <String>[];
    for (final media in current.media) {
      if (media.state == LocalMediaState.missing) continue;
      if (!await _files.exists(media.path)) gone.add(media.localMediaId);
    }
    if (gone.isEmpty) return current;

    return update(
      (snapshot) => MediaQueueSnapshot(
        media: snapshot.media
            .map(
              (value) => gone.contains(value.localMediaId)
                  ? value.copyWith(
                      state: LocalMediaState.missing,
                      failureCode: 'LOCAL_FILE_MISSING',
                      failureMessage: 'O arquivo não está mais neste aparelho.',
                    )
                  : value,
            )
            .toList(),
      ),
    );
  }

  /// A fila do contexto atual. Mídia de outro usuário não aparece nem sobe.
  Future<List<LocalMedia>> forScope(CommandScope scope) async => (await read())
      .media
      .where((value) => value.scope.matches(scope))
      .toList(growable: false);
}
