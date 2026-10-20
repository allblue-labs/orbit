/// Estado da assinatura profissional e do aceite.
library;

import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_signature_contracts.dart';
import '../../../core/network/orbit_api_client.dart';
import '../data/signature_file.dart';
import '../data/signature_repository.dart';

final signatureRepositoryProvider = Provider<SignatureRepository>(
  (ref) => SignatureRepository(client: ref.watch(apiClientProvider)),
);

/// Situação da própria assinatura.
final signatureStatusProvider =
    FutureProvider.autoDispose<MobileSignatureStatus>(
      (ref) => ref.watch(signatureRepositoryProvider).status(),
    );

/// Bytes efêmeros da própria assinatura ativa.
///
/// O grant expirado é renovado uma única vez. Uma falha de leitura também
/// força uma única releitura do status, cobrindo a expiração ocorrida entre o
/// GET autenticado e o download, sem criar loop de retry.
final signaturePreviewProvider = FutureProvider.autoDispose<Uint8List?>((
  ref,
) async {
  final cancellation = OrbitRequestCancellation();
  ref.onDispose(cancellation.cancel);
  final repository = ref.watch(signatureRepositoryProvider);
  var status = await ref.watch(signatureStatusProvider.future);
  if (!status.signatureAvailable || status.preview == null) return null;

  for (var attempt = 0; attempt < 2; attempt += 1) {
    final preview = status.preview;
    if (preview == null) return null;
    if (preview.isExpired) {
      status = await repository.status();
      continue;
    }
    try {
      return await repository.preview(preview, cancellation: cancellation);
    } on Object {
      if (attempt == 1 || cancellation.isCancelled) rethrow;
      status = await repository.status();
    }
  }
  return null;
});

/// O resumo congelado do aceite de um atendimento.
final acknowledgementPreparationProvider = FutureProvider.autoDispose
    .family<CustomerAcknowledgementPreparation, String>(
      (ref, operationId) => ref
          .watch(signatureRepositoryProvider)
          .acknowledgementPreparation(operationId),
    );

/// Em que ponto o cadastro da assinatura está.
enum SignatureUploadPhase { idle, uploading, done, rejected, failed }

class SignatureUploadState {
  const SignatureUploadState({
    this.phase = SignatureUploadPhase.idle,
    this.problem,
    this.error,
  });

  final SignatureUploadPhase phase;

  /// Recusa **antes** de subir — tamanho ou formato.
  final SignatureFileProblem? problem;

  /// Recusa do servidor ou falha de rede.
  final Object? error;

  bool get isBusy => phase == SignatureUploadPhase.uploading;
}

class SignatureUploadController extends StateNotifier<SignatureUploadState> {
  SignatureUploadController({
    required SignatureRepository repository,
    required this.onCompleted,
  }) : _repository = repository,
       super(const SignatureUploadState());

  final SignatureRepository _repository;

  /// Chamado só depois da confirmação — é aí que a assinatura passa a valer.
  final void Function() onCompleted;

  /// Confere um arquivo recém-escolhido, sem enviá-lo.
  ///
  /// Separado de [submit] porque a recusa por formato ou tamanho deve aparecer
  /// no momento da escolha, e não depois de o usuário confirmar: confirmar
  /// algo que já se sabe recusado é fazê-lo esperar por nada.
  void inspect(Uint8List bytes) {
    final check = checkSignatureFile(bytes);
    state = check.isValid
        ? const SignatureUploadState()
        : SignatureUploadState(
            phase: SignatureUploadPhase.rejected,
            problem: check.problem,
          );
  }

  /// Envia uma imagem como assinatura ativa.
  ///
  /// A checagem local existe para não gastar rede com o que já se sabe
  /// recusado; o servidor confere de novo, e é ele quem decide.
  ///
  /// A assinatura **não** é marcada como cadastrada antes da confirmação: se a
  /// rede cair entre o envio dos bytes e o `POST` final, o que existe é um
  /// arquivo órfão no storage, não uma assinatura ativa.
  Future<void> submit({
    required Uint8List bytes,
    required String fileName,
  }) async {
    if (state.isBusy) return;

    final check = checkSignatureFile(bytes);
    if (!check.isValid) {
      state = SignatureUploadState(
        phase: SignatureUploadPhase.rejected,
        problem: check.problem,
      );
      return;
    }

    state = const SignatureUploadState(phase: SignatureUploadPhase.uploading);
    try {
      await _repository.upload(
        fileName: fileName,
        mimeType: check.mimeType!,
        bytes: bytes,
      );
      state = const SignatureUploadState(phase: SignatureUploadPhase.done);
      onCompleted();
    } on Object catch (error) {
      state = SignatureUploadState(
        phase: SignatureUploadPhase.failed,
        error: error,
      );
    }
  }

  void reset() => state = const SignatureUploadState();
}

final signatureUploadControllerProvider =
    StateNotifierProvider.autoDispose<
      SignatureUploadController,
      SignatureUploadState
    >(
      (ref) => SignatureUploadController(
        repository: ref.watch(signatureRepositoryProvider),
        onCompleted: () => ref.invalidate(signatureStatusProvider),
      ),
    );
