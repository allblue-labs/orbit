/// Validação do arquivo de assinatura, antes de gastar rede.
///
/// O backend continua sendo a autoridade — ele confere tipo, tamanho e hash de
/// novo. Isto aqui existe para não fazer o profissional esperar um upload que
/// já se sabe que vai ser recusado, e para dizer **por quê** em português.
///
/// ## Extensão não é tipo
///
/// Um arquivo chamado `assinatura.png` pode conter um JPEG — basta alguém ter
/// renomeado. Por isso a checagem é pelos **primeiros bytes**, que são o que
/// realmente identifica o formato.
library;

import 'dart:typed_data';

import '../../../core/media/media_type.dart';

/// Formatos que o backend aceita (`MobileSignatureUploadReservationDto`).
const signatureMimeTypes = <String>{'image/png', 'image/jpeg', 'image/webp'};

/// Limite do contrato: 2 MB.
const signatureMaxBytes = 2000000;

/// O que impede enviar este arquivo.
enum SignatureFileProblem { empty, tooLarge, unsupportedType }

/// Resultado da checagem: o tipo detectado ou o motivo da recusa.
class SignatureFileCheck {
  const SignatureFileCheck._({this.mimeType, this.problem});

  const SignatureFileCheck.valid(String mimeType) : this._(mimeType: mimeType);
  const SignatureFileCheck.invalid(SignatureFileProblem problem)
    : this._(problem: problem);

  final String? mimeType;
  final SignatureFileProblem? problem;

  bool get isValid => mimeType != null;
}

/// O tipo real de um arquivo de assinatura.
///
/// Delega ao detector único do aplicativo e depois estreita para o que a
/// assinatura aceita: PDF é um tipo reconhecível, mas não é uma assinatura.
String? detectImageMimeType(Uint8List bytes) {
  final detected = detectMimeType(bytes);
  return signatureMimeTypes.contains(detected) ? detected : null;
}

/// Checa tamanho e tipo real.
SignatureFileCheck checkSignatureFile(Uint8List bytes) {
  if (bytes.isEmpty) {
    return const SignatureFileCheck.invalid(SignatureFileProblem.empty);
  }
  if (bytes.length > signatureMaxBytes) {
    return const SignatureFileCheck.invalid(SignatureFileProblem.tooLarge);
  }

  final mimeType = detectImageMimeType(bytes);
  if (mimeType == null || !signatureMimeTypes.contains(mimeType)) {
    return const SignatureFileCheck.invalid(
      SignatureFileProblem.unsupportedType,
    );
  }
  return SignatureFileCheck.valid(mimeType);
}
