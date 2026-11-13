import 'dart:typed_data';

import 'package:image/image.dart' as image;

/// Real, decodable pixels with visible ink; revisions do not rely on trailing bytes.
Uint8List signaturePng({int revision = 0}) {
  final canvas = image.Image(width: 160, height: 80, numChannels: 4);
  image.fill(canvas, color: image.ColorRgba8(255, 255, 255, 255));
  image.drawLine(
    canvas,
    x1: 15,
    y1: 20,
    x2: 140,
    y2: 55,
    color: image.ColorRgba8(20, 35, 50, 255),
    thickness: 7,
  );
  for (var bit = 0; bit < 32; bit++) {
    canvas.setPixelRgba(
      bit + 10,
      65,
      ((revision >> bit) & 1) == 1 ? 0 : 255,
      0,
      0,
      255,
    );
  }
  return Uint8List.fromList(image.encodePng(canvas));
}
