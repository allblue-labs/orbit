import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:orbit_operator/core/contracts/mobile_evidence_contracts.dart';
import 'package:orbit_operator/core/media/media_type.dart';
import 'package:orbit_operator/features/evidence/data/evidence_image.dart';
import 'package:orbit_operator/features/evidence/data/evidence_intake.dart';
import 'package:orbit_operator/features/evidence/data/media_store.dart';
import 'package:orbit_operator/features/sync/data/command_journal.dart';

void main() {
  test(
    'foto grande entra no armazenamento como JPEG de até 1 MB e hash do arquivo final',
    () async {
      final image = img.Image(width: 1700, height: 1200);
      final random = Random(42);
      for (final pixel in image) {
        pixel
          ..r = random.nextInt(256)
          ..g = random.nextInt(256)
          ..b = random.nextInt(256);
      }
      final original = img.encodePng(image);
      expect(original.length, greaterThan(evidencePhotoMaxBytes));
      final files = MemoryMediaFileStore();
      final media = await intakeEvidence(
        files: files,
        bytes: original,
        filename: 'equipamento.png',
        mimeType: 'image/png',
        scope: const CommandScope(
          userId: 'user',
          organizationId: 'org',
          businessUnitId: 'unit',
        ),
        target: const FieldEvidenceTargetRef(
          type: FieldEvidenceTarget.operation,
          id: 'op',
        ),
        category: EvidenceCategory.after,
        source: EvidenceSource.camera,
        caption: 'Filtro limpo',
      );
      final stored = (await files.read(media.path))!;
      expect(stored.length, lessThanOrEqualTo(1000000));
      expect(media.sizeBytes, stored.length);
      expect(media.sha256, sha256OfBytes(stored));
      expect(media.sha256, isNot(sha256OfBytes(original)));
      expect(media.mimeType, 'image/jpeg');
      expect(media.filename, 'equipamento.jpg');
      expect(media.caption, 'Filtro limpo');
      expect(detectMimeType(stored), 'image/jpeg');
      expect(img.decodeJpg(stored), isNotNull);
    },
  );

  test('compactação mantém a proporção e aplica a orientação da câmera', () {
    final image = img.Image(width: 60, height: 100);
    image.exif.imageIfd.orientation = 6;
    final bytes = compactEvidenceImage(img.encodeJpg(image));
    final decoded = img.decodeJpg(bytes)!;
    expect(decoded.width, 100);
    expect(decoded.height, 60);
    expect(bytes.length, lessThanOrEqualTo(evidencePhotoMaxBytes));
  });

  test('arquivo inválido não é enviado como se fosse uma imagem válida', () {
    expect(
      () => compactEvidenceImage(Uint8List.fromList([1, 2, 3])),
      throwsFormatException,
    );
  });
}
