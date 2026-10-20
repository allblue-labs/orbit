/// O documento de um atendimento.
///
/// Dois estados independentes, e a separação importa: o PDF pode estar pronto
/// no servidor enquanto o download local falhou, e o contrário também. Fundi-los
/// faria "não consegui baixar" parecer "o documento não existe".
///
/// ```text
/// ARTEFATO   o que o servidor diz sobre o documento
/// DOWNLOAD   o que este aparelho conseguiu fazer com ele
/// ```
library;

import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../data/artifact_repository.dart';
import '../data/document_file.dart';
import 'document_downloader.dart';

/// O estado do download continua sendo lido por quem já o lia.
///
/// Ele mudou de arquivo, não de significado: reexportar evita uma migração de
/// import em telas e testes que não têm nada a ver com esta separação.
export 'document_downloader.dart' show DownloadPhase, DownloadState;

class ArtifactState {
  const ArtifactState({
    this.preparation,
    this.artifact,
    this.loading = true,
    this.mutating = false,
    this.error,
    this.download = const DownloadState(),
  });

  /// A situação documental da fonte. Consultar isto **não** congela nada.
  final FieldArtifactPreparation? preparation;

  /// O artefato vigente, quando existe.
  final FieldArtifact? artifact;

  final bool loading;

  /// Um comando documental em voo — é o que desabilita o botão e impede que
  /// dois toques virem dois pedidos.
  final bool mutating;

  final Object? error;
  final DownloadState download;

  FieldArtifactStatus get status =>
      artifact?.status ?? FieldArtifactStatus.notPrepared;

  /// Vale perguntar de novo? Só enquanto há trabalho assíncrono em curso.
  bool get isTransient => artifact?.isTransient ?? false;

  List<FieldArtifactBlockedReason> get blockedReasons =>
      preparation?.eligibility.blockedReasons ?? const [];

  /// As ações do artefato quando ele existe; as da preparação quando não.
  List<FieldArtifactAllowedAction> get allowedActions =>
      artifact?.allowedActions ?? preparation?.allowedActions ?? const [];

  bool allows(FieldArtifactAllowedAction action) =>
      allowedActions.contains(action);

  ArtifactState copyWith({
    FieldArtifactPreparation? preparation,
    FieldArtifact? artifact,
    bool? loading,
    bool? mutating,
    Object? error,
    DownloadState? download,
    bool clearError = false,
  }) => ArtifactState(
    preparation: preparation ?? this.preparation,
    artifact: artifact ?? this.artifact,
    loading: loading ?? this.loading,
    mutating: mutating ?? this.mutating,
    error: clearError ? null : (error ?? this.error),
    download: download ?? this.download,
  );
}

/// Intervalo entre consultas enquanto a renderização acontece.
///
/// Cresce: os primeiros segundos cobrem o caso comum, e depois o ritmo cai
/// para não bombardear a API por um trabalho que está demorando.
Duration renderPollInterval(int attempt) => switch (attempt) {
  <= 2 => const Duration(seconds: 3),
  <= 5 => const Duration(seconds: 8),
  <= 10 => const Duration(seconds: 20),
  _ => const Duration(seconds: 60),
};

/// Depois disto, o app para de perguntar sozinho.
///
/// Um documento que não ficou pronto em muitas tentativas não vai ficar por
/// insistência — e um laço eterno em primeiro plano gasta bateria do técnico.
const renderPollLimit = 40;

class ArtifactController extends StateNotifier<ArtifactState> {
  ArtifactController({
    required ArtifactRepository repository,
    required DocumentFileStore files,
    required this.sourceType,
    required this.sourceId,
  }) : _repository = repository,
       _files = files,
       _downloader = DocumentDownloader(repository: repository, files: files),
       super(const ArtifactState()) {
    load();
  }

  final ArtifactRepository _repository;
  final DocumentFileStore _files;
  final DocumentDownloader _downloader;
  final FieldArtifactSourceType sourceType;
  final String sourceId;

  Timer? _poll;
  int _attempts = 0;

  @override
  void dispose() {
    /// Sair da tela para de perguntar. Nada de consulta em segundo plano.
    _poll?.cancel();
    super.dispose();
  }

  /// Relê a situação documental. É o que fecha todo comando.
  Future<void> load() async {
    try {
      final preparation = await _repository.preparation(
        sourceType: sourceType,
        sourceId: sourceId,
      );
      state = ArtifactState(
        preparation: preparation,
        artifact: preparation.existingArtifact,
        loading: false,
        download: state.download,
      );
      _schedulePoll();
    } on Object catch (error) {
      state = state.copyWith(loading: false, error: error);
    }
  }

  /// Congela o snapshot.
  ///
  /// Só se o servidor publicou a ação. Dois toques não viram dois documentos:
  /// o botão fica desabilitado enquanto o comando está em voo, e o servidor
  /// devolve o artefato existente se a intenção chegar duas vezes.
  Future<void> prepare() async {
    if (state.mutating) return;
    if (!state.allows(FieldArtifactAllowedAction.prepareDocument)) return;

    state = state.copyWith(mutating: true, clearError: true);
    try {
      final artifact = await _repository.prepare(
        sourceType: sourceType,
        sourceId: sourceId,
      );
      state = state.copyWith(artifact: artifact, mutating: false);
      await load();
    } on Object catch (error) {
      state = state.copyWith(mutating: false, error: error);
    }
  }

  /// Pede a renderização.
  ///
  /// A resposta significa "pedido aceito", não "PDF pronto". A partir daqui o
  /// app acompanha o estado — não o deduz.
  Future<void> render() async {
    if (state.mutating) return;
    final artifact = state.artifact;
    if (artifact == null) return;
    if (!state.allows(FieldArtifactAllowedAction.generateDocument)) return;

    state = state.copyWith(mutating: true, clearError: true);
    try {
      final updated = await _repository.render(artifact.id);
      _attempts = 0;
      state = state.copyWith(artifact: updated, mutating: false);
      _schedulePoll();
    } on Object catch (error) {
      state = state.copyWith(mutating: false, error: error);
    }
  }

  /// Emite o relatório: congela e manda renderizar, numa intenção só.
  ///
  /// ## Por que os dois passos viraram um botão
  ///
  /// Congelar e renderizar são dois atos do domínio, e continuam sendo dois
  /// pedidos. Mas para quem está em campo eles são **uma** decisão — "emitir o
  /// relatório deste atendimento" — e separá-los na tela custava dois toques com o
  /// mesmo significado, com um estado intermediário ("pronto para emitir") no qual
  /// muitos atendimentos ficavam parados: o técnico congelava, achava que tinha
  /// acabado, e o cliente não recebia nada.
  ///
  /// ## Por que não há condição nenhuma aqui
  ///
  /// Porque as duas já se protegem: cada uma recusa quando o servidor não publicou
  /// a ação dela, quando falta o artefato e quando há comando em voo. Repetir essas
  /// checagens aqui seria a segunda cópia das mesmas regras — e foi o que a
  /// mutação mostrou: retirá-las não mudava comportamento nenhum, porque eram
  /// código morto.
  ///
  /// Continua explícito: nada emite por conta própria. E continua idempotente —
  /// congelar duas vezes devolve o mesmo artefato, renderizar enquanto já corre não
  /// enfileira de novo.
  Future<void> issue() async {
    await prepare();
    await render();
  }

  /// Consulta de novo, a pedido da pessoa.
  Future<void> refresh() async {
    _attempts = 0;
    await load();
  }

  /// Agenda a próxima consulta, se e só se houver o que esperar.
  void _schedulePoll() {
    _poll?.cancel();
    if (!state.isTransient) return;
    if (_attempts >= renderPollLimit) return;

    final interval = renderPollInterval(_attempts);
    _attempts += 1;
    _poll = Timer(interval, () async {
      if (!mounted) return;
      final artifact = state.artifact;
      if (artifact == null) return;
      try {
        final updated = await _repository.get(artifact.id);
        if (!mounted) return;
        state = state.copyWith(artifact: updated, clearError: true);

        /// Ficou pronto: relê a preparação para as ações virem do servidor,
        /// e não de uma dedução sobre o status.
        if (!updated.isTransient) {
          await load();
          return;
        }
      } on Object {
        /// Falha de consulta não muda o artefato: o documento continua o que
        /// o servidor disser. Só se tenta de novo.
      }
      _schedulePoll();
    });
  }

  /// Busca o arquivo e verifica antes de considerá-lo disponível.
  ///
  /// A sequência é do [DocumentDownloader] — a mesma que a tela de Documentos
  /// usa. Aqui fica só o que é desta tela: a checagem de que o servidor
  /// autorizou a ação, e a projeção de cada etapa no estado.
  Future<void> download({bool preview = false}) async {
    if (state.download.isBusy) return;
    final artifact = state.artifact;
    if (artifact == null) return;

    final action = preview
        ? FieldArtifactAllowedAction.viewDocument
        : FieldArtifactAllowedAction.downloadDocument;
    if (!state.allows(action)) return;

    final stream = _downloader.fetch(
      artifactId: artifact.id,
      fileName: documentFileName(
        documentType: artifact.documentType.name,
        snapshotVersion: artifact.snapshotVersion,
      ),
      preview: preview,
    );
    await for (final etapa in stream) {
      if (!mounted) return;
      state = state.copyWith(download: etapa);
    }
  }

  /// Apaga o arquivo temporário.
  Future<void> discardLocalCopy() async {
    final path = state.download.path;
    if (path != null) await _files.delete(path);
    state = state.copyWith(download: const DownloadState());
  }
}
