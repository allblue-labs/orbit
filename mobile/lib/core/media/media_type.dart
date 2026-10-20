/// Detecção de tipo por conteúdo.
///
/// Um só detector no aplicativo. Assinatura profissional e evidência de campo
/// aceitam conjuntos diferentes de formatos, mas a pergunta "que arquivo é
/// este?" é a mesma — e duas implementações da mesma pergunta acabam
/// discordando na versão em que alguém corrige só uma.
///
/// ## Extensão não é tipo
///
/// Um arquivo chamado `foto.png` pode conter um PDF: basta alguém ter
/// renomeado. A resposta está nos **primeiros bytes**, que é onde o servidor
/// também vai olhar (`sniff` do `MobileEvidenceService`) — as duas checagens
/// precisam concordar, senão o app promete um upload que o backend recusa.
library;

import 'dart:typed_data';

/// Os quatro tipos que o backend reconhece por conteúdo.
const detectableMimeTypes = <String>{
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
};

/// O tipo real, lido dos primeiros bytes.
///
/// `null` quando não é nenhum dos formatos reconhecidos — inclusive quando a
/// extensão diz outra coisa.
String? detectMimeType(Uint8List bytes) {
  if (bytes.length >= 8 &&
      bytes[0] == 0x89 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x4e &&
      bytes[3] == 0x47 &&
      bytes[4] == 0x0d &&
      bytes[5] == 0x0a &&
      bytes[6] == 0x1a &&
      bytes[7] == 0x0a) {
    return 'image/png';
  }

  if (bytes.length >= 3 &&
      bytes[0] == 0xff &&
      bytes[1] == 0xd8 &&
      bytes[2] == 0xff) {
    return 'image/jpeg';
  }

  /// WEBP é um contêiner RIFF: "RIFF" nos bytes 0–3 e "WEBP" nos 8–11.
  if (bytes.length >= 12 &&
      bytes[0] == 0x52 &&
      bytes[1] == 0x49 &&
      bytes[2] == 0x46 &&
      bytes[3] == 0x46 &&
      bytes[8] == 0x57 &&
      bytes[9] == 0x45 &&
      bytes[10] == 0x42 &&
      bytes[11] == 0x50) {
    return 'image/webp';
  }

  /// `%PDF-`, os cinco primeiros bytes de todo PDF.
  if (bytes.length >= 5 &&
      bytes[0] == 0x25 &&
      bytes[1] == 0x50 &&
      bytes[2] == 0x44 &&
      bytes[3] == 0x46 &&
      bytes[4] == 0x2d) {
    return 'application/pdf';
  }

  return null;
}
