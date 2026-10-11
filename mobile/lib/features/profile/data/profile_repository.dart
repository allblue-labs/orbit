/// Os próprios dados, e a própria foto.
///
/// ```text
/// PATCH  /identity/me                 nome, sobrenome, telefone
/// POST   /identity/me/avatar/uploads  reserva o espaço do arquivo
/// PUT    /identity/me/avatar          ativa o que foi enviado
/// DELETE /identity/me/avatar          remove
/// ```
///
/// ## Por que a foto tem três passos
///
/// O arquivo não passa pela API: ela devolve um endereço temporário, o
/// aplicativo envia os bytes direto para o armazenamento e só então avisa
/// que terminou. É o mesmo caminho das evidências de campo — e existe pela
/// mesma razão: um PDF ou uma foto de 5 MB atravessando o servidor de
/// aplicação ocupa uma conexão que deveria estar respondendo consultas.
library;

import 'dart:typed_data';

import '../../../core/contracts/session_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

/// O espaço reservado para o arquivo, antes de ele existir.
///
/// ## O formato é aninhado, e era lido como se fosse plano
///
/// `POST /identity/me/avatar/uploads` responde
/// `{ fileId, upload: { url, expiresAt, method, requiredHeaders } }` — a mesma forma
/// que a reserva da assinatura, porque as duas saem do mesmo `files.reserve`.
///
/// A leitura anterior procurava `storageObjectId`, `uploadUrl`/`url` e `headers` na
/// **raiz**. Nenhum dos três existe ali. Com `?? ''` em cada um, o resultado não era
/// um erro: era um bilhete vazio, que mandava os bytes para `Uri.parse('')` e depois
/// ativava o arquivo de id `''`. A troca de foto nunca funcionou, e o default
/// silencioso é o que escondeu isso — um campo ausente virava string vazia em vez de
/// exceção, e o erro só aparecia como "não consigo adicionar a foto".
///
/// Por isso os `!` abaixo, e nenhum default: campo que falta é contrato quebrado, e
/// contrato quebrado precisa estourar onde foi lido.
class AvatarUploadTicket {
  const AvatarUploadTicket({
    required this.storageObjectId,
    required this.uploadUrl,
    this.headers = const {},
  });

  factory AvatarUploadTicket.fromJson(Map<String, dynamic> json) {
    final upload = json['upload']! as Map<String, Object?>;
    final headers = upload['requiredHeaders'] as Map<String, Object?>?;
    return AvatarUploadTicket(
      /// `fileId` no corpo, `storageObjectId` no comando que ativa: os dois nomes
      /// são do servidor, e é ele quem os escolhe em cada ponta.
      storageObjectId: json['fileId']! as String,
      uploadUrl: upload['url']! as String,
      headers:
          headers?.map((chave, valor) => MapEntry(chave, '$valor')) ??
          const {},
    );
  }

  final String storageObjectId;
  final String uploadUrl;
  final Map<String, String> headers;
}

class ProfileRepository {
  const ProfileRepository({required OrbitApiClient client}) : _client = client;

  final OrbitApiClient _client;

  /// Atualiza o que a pessoa pode mudar sobre si.
  ///
  /// E-mail não está aqui: trocar e-mail é trocar credencial de acesso, e
  /// isso passa por confirmação no endereço novo — fluxo do produto web.
  Future<OrbitUser> update({
    String? firstName,
    String? lastName,
    String? displayName,
    String? phone,
  }) async {
    final data = await _client.patch<Map<String, dynamic>>(
      '/identity/me',
      body: {
        if (firstName != null) 'firstName': firstName,
        if (lastName != null) 'lastName': lastName,
        if (displayName != null) 'displayName': displayName,
        if (phone != null) 'phone': phone,
      },
    );
    return OrbitUser.fromJson(data, resolverUrl: _client.resolveUrl);
  }

  Future<AvatarUploadTicket> reserveAvatar({
    required String fileName,
    required String mimeType,
    required int sizeBytes,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/identity/me/avatar/uploads',
      body: {
        'fileName': fileName,
        'mimeType': mimeType,
        'sizeBytes': sizeBytes,
      },
    );
    return AvatarUploadTicket.fromJson(data);
  }

  /// Envia os bytes para o endereço reservado.
  ///
  /// Vai por [OrbitApiClient.putBytes], que **não** manda o token da sessão:
  /// a própria assinatura da URL é a credencial, e enviar o `Bearer` para
  /// fora da API seria vazá-lo para o armazenamento.
  Future<void> putAvatarBytes({
    required AvatarUploadTicket ticket,
    required Uint8List bytes,
    required String mimeType,
  }) => _client.putBytes(
    url: Uri.parse(ticket.uploadUrl),
    bytes: bytes,
    headers: {'content-type': mimeType, ...ticket.headers},
  );

  Future<void> activateAvatar(String storageObjectId) =>
      _client.put<Map<String, dynamic>>(
        '/identity/me/avatar',
        body: {'storageObjectId': storageObjectId},
      );

  Future<void> removeAvatar() =>
      _client.delete<Map<String, dynamic>>('/identity/me/avatar');

  /// Não há desembrulho aqui: [OrbitApiClient] já extrai `data` do envelope.
  /// Fazer de novo devolveria `null` e o perfil voltaria vazio.
}
