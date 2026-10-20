/// Entregar um documento a alguém, pelo caminho do sistema.
///
/// ## Por que a folha é do sistema operacional
///
/// O produto não sabe — e não deve saber — se o cliente prefere WhatsApp,
/// e-mail ou AirDrop. Quem sabe é o aparelho, que já tem a lista de destinos
/// instalados e as permissões deles. Construir uma lista própria significaria
/// manter integrações que envelhecem a cada atualização de sistema.
///
/// ## O arquivo vem antes
///
/// Não dá para compartilhar uma URL assinada: ela expira, e do outro lado
/// chega um link morto. O documento é baixado, verificado e **só então**
/// entregue à folha — o que chega ao cliente é o PDF, não um endereço.
library;

import 'dart:async';
import 'dart:ui' show Rect;

import 'package:share_plus/share_plus.dart';

import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../artifact/application/document_downloader.dart';

/// Onde o compartilhamento está.
enum SharePhase { preparing, ready, error }

class ShareState {
  const ShareState({required this.phase, this.error});

  final SharePhase phase;
  final Object? error;

  bool get isBusy => phase == SharePhase.preparing;
}

class DocumentSharing {
  const DocumentSharing({required DocumentDownloader downloader})
    : _downloader = downloader;

  final DocumentDownloader _downloader;

  /// Baixa e abre a folha de compartilhamento do sistema.
  ///
  /// O arquivo temporário **não** é apagado ao fim: a folha do sistema é
  /// assíncrona e o destino pode ler o arquivo depois que ela fecha. Apagar
  /// cedo entrega um anexo vazio no WhatsApp — e o remetente só descobre
  /// quando o cliente reclama.
  /// [origin] é de onde a folha sai, em coordenadas de tela.
  ///
  /// O iPad ancora o popover nesse retângulo e **lança exceção** sem ele — no
  /// iPhone o parâmetro é ignorado. Um `null` aqui é um travamento que só
  /// aparece no aparelho que ninguém usou para testar.
  Stream<ShareState> share({
    required String artifactId,
    required String fileName,
    String? subject,
    Rect? origin,
  }) => shareWith(
    access: null,
    artifactId: artifactId,
    fileName: fileName,
    subject: subject,
    origin: origin,
  );

  /// O mesmo compartilhamento, com o acesso vindo de outra autoridade.
  ///
  /// `access` presente substitui a resolução pelo artefato de campo — é como o
  /// documento de PMOC, que mora numa execução de artefato, chega à folha do
  /// sistema sem uma segunda implementação de baixar-conferir-gravar-compartilhar.
  Stream<ShareState> shareWith({
    required Future<FieldArtifactAccess> Function()? access,
    String? artifactId,
    required String fileName,
    String? subject,
    Rect? origin,
  }) async* {
    yield const ShareState(phase: SharePhase.preparing);

    final download = access == null
        ? _downloader.fetch(artifactId: artifactId!, fileName: fileName)
        : _downloader.fetchWith(access: access, fileName: fileName);

    await for (final estado in download) {
      if (estado.phase == DownloadPhase.error) {
        yield ShareState(phase: SharePhase.error, error: estado.error);
        return;
      }
      if (estado.phase != DownloadPhase.availableLocally) continue;

      final caminho = estado.path;
      if (caminho == null) {
        yield const ShareState(phase: SharePhase.error);
        return;
      }

      await SharePlus.instance.share(
        ShareParams(
          files: [XFile(caminho, mimeType: 'application/pdf')],
          subject: subject,
          sharePositionOrigin: origin,
        ),
      );
      yield const ShareState(phase: SharePhase.ready);
      return;
    }
  }
}
