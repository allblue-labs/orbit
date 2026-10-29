import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/errors/orbit_exception.dart';
import 'package:orbit_operator/features/artifact/data/document_file.dart';

void main() {
  late Directory directory;
  late TemporaryDocumentFileStore store;
  setUp(() async {
    directory = await Directory.systemTemp.createTemp('orbit-document-files-');
    store = TemporaryDocumentFileStore(directory: directory);
  });
  tearDown(() async {
    if (await directory.exists()) await directory.delete(recursive: true);
  });

  test(
    'downloads simultâneos com o mesmo nome conservam os dois documentos',
    () async {
      final paths = await Future.wait([
        store.write('relatorio.pdf', [37, 80, 68, 70, 1]),
        store.write('relatorio.pdf', [37, 80, 68, 70, 2]),
      ]);
      expect(paths.toSet(), hasLength(2));
      expect(paths.every((path) => path.endsWith('/relatorio.pdf')), isTrue);
      expect(await File(paths[0]).readAsBytes(), [37, 80, 68, 70, 1]);
      expect(await File(paths[1]).readAsBytes(), [37, 80, 68, 70, 2]);
      await store.delete(paths[0]);
      expect(await store.exists(paths[0]), isFalse);
      expect(await store.exists(paths[1]), isTrue);
      await store.purge();
      expect(await directory.list().isEmpty, isTrue);
    },
  );

  test('nomes recebidos não permitem sair do armazenamento privado', () async {
    final path = await store.write('../../relatorio.pdf', [1]);
    expect(path.startsWith('${directory.path}/documento-'), isTrue);
    expect(path.endsWith('/relatorio.pdf'), isTrue);
    await expectLater(store.write('..', [1]), throwsFormatException);
  });

  test(
    'encerrar o contexto durante a escrita remove somente aquele download',
    () async {
      final writing = store.write('relatorio.pdf', List.filled(1024 * 1024, 1));
      store.close();
      await expectLater(
        writing,
        throwsA(
          isA<OrbitException>().having(
            (e) => e.code,
            'code',
            'SESSION_CHANGED',
          ),
        ),
      );
      expect(await directory.list().isEmpty, isTrue);
    },
  );
}
