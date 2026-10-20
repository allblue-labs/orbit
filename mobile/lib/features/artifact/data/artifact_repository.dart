/// O transporte do documento de campo.
///
/// Cinco chamadas e nenhuma decisão. Quem orquestra é o controlador — e nada
/// aqui monta snapshot, HTML ou PDF: o documento é produzido pelo servidor, e
/// o app só o consulta e o busca.
library;

import '../../../core/contracts/mobile_field_artifact_contracts.dart';
import '../../../core/network/orbit_api_client.dart';

class ArtifactRepository {
  const ArtifactRepository({required OrbitApiClient client}) : _client = client;

  final OrbitApiClient _client;

  /// A situação documental de uma fonte, **sem congelar nada**.
  Future<FieldArtifactPreparation> preparation({
    required FieldArtifactSourceType sourceType,
    required String sourceId,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/artifacts/sources/$sourceId/preparation',
      query: {'sourceType': fieldArtifactSourceTypeWire(sourceType)},
    );
    return FieldArtifactPreparation.fromJson(data);
  }

  /// Congela o snapshot.
  ///
  /// Irreversível por natureza: a partir daqui o documento tem uma versão de
  /// fatos própria, e mudanças posteriores na fonte não a reescrevem. Repetir
  /// devolve o artefato existente em vez de criar um segundo — a idempotência
  /// é do servidor, sob advisory lock.
  Future<FieldArtifact> prepare({
    required FieldArtifactSourceType sourceType,
    required String sourceId,
  }) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/artifacts/sources/$sourceId/prepare',
      body: {'sourceType': fieldArtifactSourceTypeWire(sourceType)},
    );
    return FieldArtifact.fromJson(data);
  }

  Future<FieldArtifact> get(String artifactId) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/artifacts/$artifactId',
    );
    return FieldArtifact.fromJson(data);
  }

  /// Agenda a renderização.
  ///
  /// A resposta diz que o pedido foi aceito, **não** que o PDF existe: o
  /// trabalho acontece fora desta requisição. Repetir enquanto já está
  /// `PENDING`, `RENDERING` ou `READY` devolve o mesmo estado, sem enfileirar
  /// de novo.
  Future<FieldArtifact> render(String artifactId) async {
    final data = await _client.post<Map<String, dynamic>>(
      '/mobile/field/artifacts/$artifactId/render',
      body: const <String, Object?>{},
    );
    return FieldArtifact.fromJson(data);
  }

  /// Um acesso temporário ao arquivo.
  Future<FieldArtifactAccess> access(
    String artifactId, {
    bool preview = false,
  }) async {
    final data = await _client.get<Map<String, dynamic>>(
      '/mobile/field/artifacts/$artifactId/access',
      query: {'operation': preview ? 'preview' : 'download'},
    );
    return FieldArtifactAccess.fromJson(data);
  }

  /// Baixa os bytes de uma URL assinada.
  ///
  /// Sem o token da sessão: a assinatura da URL já é a credencial, e mandar o
  /// `Bearer` para o storage seria vazá-lo para fora da API.
  Future<({List<int> bytes, String? contentType, String? fileName})> download(
    FieldArtifactAccess access,
  ) => _client.getBytes(url: access.url, headers: access.requiredHeaders);
}
