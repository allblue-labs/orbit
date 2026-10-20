/// De onde o arquivo vem.
///
/// Separa a **origem** (câmera, galeria, seletor de arquivos) do que se faz
/// com os bytes. É injetável para que o teste exercite o fluxo sem plugin — o
/// que se quer provar é a decisão do app, não o seletor do sistema.
///
/// A permissão só é pedida quando a pessoa inicia uma captura. Pedir câmera na
/// abertura do aplicativo treina o usuário a negar.
library;

import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/services.dart' show PlatformException;
import 'package:image_picker/image_picker.dart';

/// Um arquivo escolhido, ainda em memória, antes de qualquer decisão.
final class CapturedFile {
  const CapturedFile({
    required this.bytes,
    required this.filename,
    required this.origin,
  });

  final Uint8List bytes;
  final String filename;

  /// Registro de proveniência — vai no envelope como `source`.
  final CaptureOrigin origin;
}

enum CaptureOrigin { camera, gallery, file }

/// Por que não deu para capturar.
///
/// Permissão negada de vez é diferente de negada agora: a primeira só se
/// resolve nas Configurações do sistema, e a mensagem precisa dizer isso.
enum CaptureProblem { permissionDenied, permissionPermanentlyDenied, failed }

class CaptureException implements Exception {
  const CaptureException(this.problem);
  final CaptureProblem problem;
}

abstract interface class MediaCaptureSource {
  Future<CapturedFile?> takePhoto();
  Future<CapturedFile?> pickImage();
  Future<CapturedFile?> pickDocument();
}

class PlatformMediaCaptureSource implements MediaCaptureSource {
  const PlatformMediaCaptureSource();

  @override
  Future<CapturedFile?> takePhoto() => _pickImage(ImageSource.camera);

  @override
  Future<CapturedFile?> pickImage() => _pickImage(ImageSource.gallery);

  Future<CapturedFile?> _pickImage(ImageSource source) async {
    try {
      final picked = await ImagePicker().pickImage(
        source: source,

        /// Redimensiona no momento da captura, **antes** de qualquer hash.
        /// Comprimir depois de calcular o SHA-256 enviaria um arquivo que não
        /// corresponde ao hash declarado, e o servidor recusaria — com razão.
        maxWidth: 2400,
        imageQuality: 85,
      );
      if (picked == null) return null;
      return CapturedFile(
        bytes: await picked.readAsBytes(),
        filename: picked.name,
        origin: source == ImageSource.camera
            ? CaptureOrigin.camera
            : CaptureOrigin.gallery,
      );
    } on PlatformException catch (error) {
      throw CaptureException(_problemOf(error));
    }
  }

  @override
  Future<CapturedFile?> pickDocument() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: const ['pdf'],
        withData: true,
      );
      final file = result?.files.firstOrNull;
      if (file?.bytes == null) return null;
      return CapturedFile(
        bytes: file!.bytes!,
        filename: file.name,
        origin: CaptureOrigin.file,
      );
    } on PlatformException catch (error) {
      throw CaptureException(_problemOf(error));
    }
  }

  /// O `image_picker` sinaliza permissão negada pelo código do erro; a
  /// distinção entre "negou agora" e "negou de vez" vem daí.
  CaptureProblem _problemOf(PlatformException error) => switch (error.code) {
    'camera_access_denied' ||
    'photo_access_denied' => CaptureProblem.permissionPermanentlyDenied,
    'invalid_image' => CaptureProblem.failed,
    _ => CaptureProblem.failed,
  };
}
