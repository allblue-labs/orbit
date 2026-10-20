/// Buscar o arquivo de um documento, verificar e guardar.
///
/// ## Por que isto é um serviço, e não um método de tela
///
/// A sequência é sempre a mesma — pedir acesso, baixar, **conferir os bytes**,
/// gravar — e agora ela é pedida de dois lugares: da execução de um
/// atendimento e da lista de Documentos. Duplicá-la significaria que um dia a
/// verificação do PDF seria corrigida num lado só, e o outro passaria a aceitar
/// uma página de erro HTML como se fosse documento.
///
/// O que continua **não** estando aqui é a autorização: quem decide se o
/// arquivo pode ser aberto é o servidor, na resposta de `access`. Este serviço
/// transporta.
library;

import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../data/artifact_repository.dart';
import '../data/document_file.dart';

/// Onde o download parou — **neste** aparelho.
enum DownloadPhase {
  idle,
  requestingUrl,
  downloading,
  verifying,
  availableLocally,
  error,
}

class DownloadState {
  const DownloadState({
    this.phase = DownloadPhase.idle,
    this.progress,
    this.path,
    this.error,
  });

  final DownloadPhase phase;
  final double? progress;

  /// Caminho local do arquivo já verificado. Temporário.
  final String? path;
  final Object? error;

  bool get isBusy =>
      phase == DownloadPhase.requestingUrl ||
      phase == DownloadPhase.downloading ||
      phase == DownloadPhase.verifying;
}

/// A sequência inteira, emitindo cada etapa.
///
/// Emite em vez de devolver só o fim porque a espera é longa o bastante para
/// merecer texto na tela: "pedindo acesso" e "baixando" são situações
/// diferentes, e um indicador genérico esconderia qual delas travou.
class DocumentDownloader {
  const DocumentDownloader({
    required ArtifactRepository repository,
    required DocumentFileStore files,
  }) : _repository = repository,
       _files = files;

  final ArtifactRepository _repository;
  final DocumentFileStore _files;

  Stream<DownloadState> fetch({
    required String artifactId,
    required String fileName,
    bool preview = false,
  }) => fetchWith(
    access: () => _repository.access(artifactId, preview: preview),
    fileName: fileName,
  );

  /// A mesma sequência, com o acesso vindo de **outra autoridade**.
  ///
  /// O PMOC não tem artefato de campo: o documento dele é uma execução de
  /// artefato, e a URL assinada sai da revisão emitida. O que não muda é o que se
  /// faz com ela — baixar, **conferir os bytes** e gravar. Duplicar essa parte
  /// significaria que um dia a verificação do PDF seria corrigida num lado só, e o
  /// outro passaria a aceitar uma página de erro HTML como se fosse documento.
  Stream<DownloadState> fetchWith({
    required Future<FieldArtifactAccess> Function() access,
    required String fileName,
  }) async* {
    yield const DownloadState(phase: DownloadPhase.requestingUrl);
    try {
      /// A URL é pedida agora e usada agora. Não vira estado.
      final signed = await access();

      yield const DownloadState(phase: DownloadPhase.downloading);
      final result = await _repository.download(signed);

      yield const DownloadState(phase: DownloadPhase.verifying);
      final problem = checkDocumentBytes(result.bytes);
      if (problem != null) {
        yield DownloadState(
          phase: DownloadPhase.error,
          error: OrbitException(
            kind: OrbitErrorKind.parse,
            publicMessage: problem == DocumentFileProblem.empty
                ? 'Não foi possível abrir este documento agora.'
                : 'Não foi possível abrir este documento agora.',
            code: 'INVALID_DOCUMENT',
          ),
        );
        return;
      }

      /// O nome publicado pelo servidor vence; o construído é reserva para
      /// quando o cabeçalho não vem.
      final path = await _files.write(
        result.fileName ?? fileName,
        result.bytes,
      );
      yield DownloadState(phase: DownloadPhase.availableLocally, path: path);
    } on Object catch (error) {
      /// O download falhou; o documento no servidor continua o que era.
      yield DownloadState(phase: DownloadPhase.error, error: error);
    }
  }

  /// Apaga o arquivo temporário.
  Future<void> discard(String? path) async {
    if (path != null) await _files.delete(path);
  }
}
