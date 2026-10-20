/// Executor de upload sobre o cliente HTTP do aplicativo.
///
/// Endpoint real: `POST /operations/:id/attachments`, `multipart/form-data`,
/// campo `file`, um arquivo por requisição, limite de 20 MB
/// (`FileInterceptor` no backend). Exige capability `operations.manage` e
/// permissão `operations.attachments.create`.
library;

import 'package:dio/dio.dart';

import '../errors/orbit_exception.dart';
import '../network/orbit_api_client.dart';
import 'upload_queue.dart';

/// Limite do backend. Validado antes de enviar para não gastar rede até o 413.
const int maxAttachmentBytes = 20 * 1024 * 1024;

/// Cria o executor que a fila usa para enviar cada tarefa.
UploadExecutor createAttachmentUploadExecutor(OrbitApiClient client) {
  return (task, {required onProgress, required cancellation}) async {
    if (task.sizeInBytes > maxAttachmentBytes) {
      // Erro definitivo: repetir não resolve tamanho.
      throw const OrbitException(
        kind: OrbitErrorKind.http,
        status: 413,
        code: 'PAYLOAD_TOO_LARGE',

        /// Fala do arquivo, não do servidor: o limite é do produto, e quem
        /// precisa agir é quem escolheu a foto.
        publicMessage: 'Este arquivo passa do limite de 20 MB.',
      );
    }

    final cancelToken = CancelToken();
    cancellation.onCancel(cancelToken.cancel);

    await client.upload<Map<String, dynamic>>(
      '/operations/${task.operationId}/attachments',
      filePath: task.filePath,
      fileName: task.fileName,
      mimeType: task.mimeType,
      cancelToken: cancelToken,
      onProgress: onProgress,
    );
  };
}
