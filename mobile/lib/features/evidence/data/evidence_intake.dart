/// De arquivo escolhido a registro local.
///
/// O ponto do arquivo é a fronteira: aqui os bytes deixam de ser "algo que a
/// pessoa escolheu" e passam a ser um registro que sobrevive a fechar o app.
/// Antes disto não há nada a enviar; depois, há trabalho guardado.
library;

import 'dart:math';
import 'dart:typed_data';

import '../../../core/contracts/mobile_evidence_contracts.dart';
import '../../../core/media/media_type.dart';
import '../../sync/data/command_journal.dart' show CommandScope;
import 'local_media.dart';
import 'media_store.dart';

/// O que impede usar este arquivo.
enum EvidenceFileProblem { empty, tooLarge, unsupportedType }

class EvidenceFileCheck {
  const EvidenceFileCheck._({this.mimeType, this.problem});

  const EvidenceFileCheck.valid(String mimeType) : this._(mimeType: mimeType);
  const EvidenceFileCheck.invalid(EvidenceFileProblem problem)
    : this._(problem: problem);

  final String? mimeType;
  final EvidenceFileProblem? problem;

  bool get isValid => mimeType != null;
}

/// Limites do backend (`mobile-evidence.config.ts`), com os padrões publicados.
///
/// A checagem local existe para não gastar rede com o que já se sabe recusado.
/// A autoridade continua sendo o servidor: ele confere de novo, sobre o objeto
/// real, e devolve o `maxSize` vigente na própria reserva.
const evidenceImageMaxBytes = 10000000;
const evidenceDocumentMaxBytes = 20000000;

int evidenceMaxBytesFor(String mimeType) => mimeType == 'application/pdf'
    ? evidenceDocumentMaxBytes
    : evidenceImageMaxBytes;

/// Confere tipo real e tamanho.
EvidenceFileCheck checkEvidenceFile(Uint8List bytes) {
  if (bytes.isEmpty) {
    return const EvidenceFileCheck.invalid(EvidenceFileProblem.empty);
  }

  /// Pelos primeiros bytes, como o servidor faz. A extensão pode mentir.
  final mimeType = detectMimeType(bytes);
  if (mimeType == null) {
    return const EvidenceFileCheck.invalid(EvidenceFileProblem.unsupportedType);
  }
  if (bytes.length > evidenceMaxBytesFor(mimeType)) {
    return const EvidenceFileCheck.invalid(EvidenceFileProblem.tooLarge);
  }
  return EvidenceFileCheck.valid(mimeType);
}

/// Gera a identidade do arquivo no aparelho.
///
/// Aleatória e estável: nasce com a captura e acompanha a mídia até a
/// evidência existir. O servidor casa intenções por ela, então dois registros
/// com o mesmo `localMediaId` seriam a mesma evidência — e é justamente isso
/// que impede a mesma foto de entrar duas vezes.
String newLocalMediaId([Random? random]) {
  final rng = random ?? Random.secure();
  final bytes = List<int>.generate(16, (_) => rng.nextInt(256));
  return 'lm-${bytes.map((byte) => byte.toRadixString(16).padLeft(2, '0')).join()}';
}

/// Persiste os bytes e devolve o registro.
///
/// O hash é calculado sobre os bytes **exatos** que serão gravados e enviados.
/// Nada é transformado depois disto — comprimir após o hash faria o servidor
/// recusar por divergência, e ele estaria certo.
Future<LocalMedia> intakeEvidence({
  required MediaFileStore files,
  required Uint8List bytes,
  required String filename,
  required String mimeType,
  required CommandScope scope,
  required FieldEvidenceTargetRef target,
  required EvidenceCategory category,
  required EvidenceSource source,
  DateTime? capturedAt,
  String? localMediaId,
}) async {
  final id = localMediaId ?? newLocalMediaId();
  final path = await files.persist(id, extensionForMime(mimeType), bytes);

  return LocalMedia(
    localMediaId: id,
    scope: scope,
    target: target,
    path: path,
    filename: filename,
    mimeType: mimeType,
    sizeBytes: bytes.length,
    sha256: sha256OfBytes(bytes),
    capturedAt: capturedAt ?? DateTime.now().toUtc(),
    category: category,
    source: source,
    state: LocalMediaState.pending,

    /// Derivada do `localMediaId` e congelada: o servidor guarda o hash do
    /// conteúdo junto da chave, e regenerá-la a cada tentativa produziria
    /// `IDEMPOTENCY_MISMATCH`.
    idempotencyKey: 'evidence:$id',
  );
}
