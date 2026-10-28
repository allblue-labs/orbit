import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:image/image.dart' as img;

/// Limite do arquivo final, antes de persistir e calcular o SHA-256.
const evidencePhotoMaxBytes = 1000000;

Future<Uint8List> prepareEvidenceImage(Uint8List bytes) =>
    compute(compactEvidenceImage, bytes);

/// Executado fora da thread da interface. Sempre produz JPEG, inclusive quando
/// a câmera/galeria entrega PNG ou WebP, que nem todo leitor de PDF aceita.
Uint8List compactEvidenceImage(Uint8List bytes) {
  final decoded = img.decodeImage(bytes);
  if (decoded == null) throw const FormatException('Imagem inválida.');
  var image = img.bakeOrientation(decoded);
  var longest = math.max(image.width, image.height);
  if (longest > 2000) {
    final factor = 2000 / longest;
    image = img.copyResize(
      image,
      width: math.max(1, (image.width * factor).round()),
      height: math.max(1, (image.height * factor).round()),
      interpolation: img.Interpolation.average,
    );
  }
  // Metadados grandes não podem consumir o orçamento reservado à fotografia.
  image.exif.clear();
  image.iccProfile = null;
  for (var pass = 0; pass < 8; pass++) {
    for (final quality in [85, 72, 60, 45]) {
      final encoded = img.encodeJpg(image, quality: quality);
      if (encoded.length <= evidencePhotoMaxBytes) return encoded;
    }
    longest = math.max(image.width, image.height);
    if (longest <= 320) break;
    image = img.copyResize(
      image,
      width: math.max(1, (image.width * .75).round()),
      height: math.max(1, (image.height * .75).round()),
      interpolation: img.Interpolation.average,
    );
  }
  throw const FormatException('Não foi possível compactar a imagem.');
}

String evidenceJpegName(String filename) =>
    '${filename.replaceFirst(RegExp(r'\.[^.]+$'), '')}.jpg';
